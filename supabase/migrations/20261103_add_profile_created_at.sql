-- Record when each application profile was created.
-- Existing rows use the matching Supabase Auth account creation time when
-- available. Future inserts receive the database transaction time by default.

begin;

alter table public.profiles
  add column if not exists created_at timestamptz;

-- Drop the enforcement trigger first so rerunning this migration can repair
-- any legacy NULL timestamps before the trigger makes the field immutable.
drop trigger if exists profiles_set_created_at on public.profiles;

update public.profiles as profile
set created_at = auth_user.created_at
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.created_at is null;

-- A profile without a matching Auth user cannot be dated historically. Keep
-- the column usable and non-null by assigning the migration transaction time.
update public.profiles
set created_at = now()
where created_at is null;

alter table public.profiles
  alter column created_at set default now(),
  alter column created_at set not null;

create or replace function public.set_profile_created_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    -- Do not trust a client-supplied creation time. This also protects profile
    -- upserts that explicitly send NULL for columns omitted from their payload.
    new.created_at := now();
  else
    -- Profile/photo upserts must never rewrite the original creation time.
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

revoke all on function public.set_profile_created_at() from public;

create trigger profiles_set_created_at
before insert or update on public.profiles
for each row execute function public.set_profile_created_at();

comment on column public.profiles.created_at is
  'Immutable application-profile creation time. Existing rows were backfilled from auth.users.created_at where possible.';

commit;
