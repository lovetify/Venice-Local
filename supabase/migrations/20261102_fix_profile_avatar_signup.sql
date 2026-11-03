-- Keep profile-picture bytes out of Supabase Auth metadata/JWTs.
-- Run this once in the Supabase SQL Editor after deploying the matching app code.
-- It preserves any avatar already stored in public.profiles; it removes only the
-- oversized duplicate from auth.users metadata so the next login gets a small JWT.

begin;

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'avatar'
where coalesce(raw_user_meta_data ->> 'avatar', '') like 'data:image/%';

-- Profile rows are self-service for normal account data, but administrator
-- status is trusted data and must never come from editable Auth metadata.
alter table public.profiles enable row level security;
grant select, insert, update on table public.profiles to authenticated;
revoke select, insert, update, delete on table public.profiles from anon;

drop policy if exists "Profile reads stay user scoped" on public.profiles;
drop policy if exists "Profile inserts stay user scoped" on public.profiles;
drop policy if exists "Profile updates stay user scoped" on public.profiles;
drop policy if exists "Profile deletes stay user scoped" on public.profiles;
drop policy if exists "Users read own profile" on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;

create policy "Profile reads stay user scoped"
  on public.profiles as restrictive for select to anon, authenticated
  using (auth.uid() is not null and id = auth.uid());

create policy "Profile inserts stay user scoped"
  on public.profiles as restrictive for insert to anon, authenticated
  with check (auth.uid() is not null and id = auth.uid());

create policy "Profile updates stay user scoped"
  on public.profiles as restrictive for update to anon, authenticated
  using (auth.uid() is not null and id = auth.uid())
  with check (auth.uid() is not null and id = auth.uid());

create policy "Profile deletes stay user scoped"
  on public.profiles as restrictive for delete to anon, authenticated
  using (auth.uid() is not null and id = auth.uid());

create policy "Users read own profile"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "Users insert own profile"
  on public.profiles for insert to authenticated
  with check (id = auth.uid());

create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.guard_self_service_profile_role()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
  existing_admin boolean := false;
begin
  -- BEFORE INSERT also runs for UPSERT and for auth.users profile triggers.
  -- Never allow a brand-new admin row from signup metadata, even when there is
  -- no end-user auth.uid(). An existing trusted admin row is the only exception.
  if tg_op = 'INSERT' and new.role::text = 'admin' then
    select exists (
      select 1
      from public.profiles p
      where p.id = new.id and p.role::text = 'admin'
    ) into existing_admin;
    if not existing_admin then
      raise exception 'Administrator profiles must be assigned through a trusted update.';
    end if;
  end if;

  -- SQL Editor/service-role maintenance has no end-user auth.uid() and remains
  -- able to assign admin through UPDATE, which is the documented admin flow.
  if caller_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.id is distinct from caller_id then
      raise exception 'A user can create only their own profile.';
    end if;
    if coalesce(new.role::text, '') not in ('patron', 'owner', 'admin') then
      raise exception 'The requested self-service role is not allowed.';
    end if;
  elsif tg_op = 'UPDATE' then
    if old.id is distinct from caller_id or new.id is distinct from old.id then
      raise exception 'A user can update only their own profile.';
    end if;
    if old.role::text = 'admin' then
      new.role := old.role;
    elsif coalesce(new.role::text, '') not in ('patron', 'owner') then
      raise exception 'The requested self-service role is not allowed.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_self_service_profile_role() from public;
drop trigger if exists profiles_guard_self_service_role on public.profiles;
create trigger profiles_guard_self_service_role
before insert or update on public.profiles
for each row execute function public.guard_self_service_profile_role();

-- New uploads use business-media/avatars/<auth.uid()>/<file>.
-- Restrictive write guards prevent broader pre-existing bucket policies from
-- allowing anonymous writes or one user changing another user's avatar.
drop policy if exists "Avatar paths stay user scoped" on storage.objects;
drop policy if exists "Avatar uploads stay user scoped" on storage.objects;
drop policy if exists "Avatar updates stay user scoped" on storage.objects;
drop policy if exists "Avatar deletes stay user scoped" on storage.objects;
drop policy if exists "Users read own avatar images" on storage.objects;
drop policy if exists "Users upload own avatar images" on storage.objects;
drop policy if exists "Users update own avatar images" on storage.objects;
drop policy if exists "Users delete own avatar images" on storage.objects;

create policy "Avatar uploads stay user scoped"
  on storage.objects as restrictive for insert to anon, authenticated
  with check (
    bucket_id <> 'business-media'
    or coalesce((storage.foldername(name))[1], '') <> 'avatars'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create policy "Avatar updates stay user scoped"
  on storage.objects as restrictive for update to anon, authenticated
  using (
    bucket_id <> 'business-media'
    or coalesce((storage.foldername(name))[1], '') <> 'avatars'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
  with check (
    bucket_id <> 'business-media'
    or coalesce((storage.foldername(name))[1], '') <> 'avatars'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create policy "Avatar deletes stay user scoped"
  on storage.objects as restrictive for delete to anon, authenticated
  using (
    bucket_id <> 'business-media'
    or coalesce((storage.foldername(name))[1], '') <> 'avatars'
    or (
      auth.uid() is not null
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create policy "Users read own avatar images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Users upload own avatar images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Users update own avatar images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "Users delete own avatar images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

commit;
