-- Venice Local: additive community-events feature.
-- Run this migration in the Supabase SQL Editor (or your normal migration runner).
-- It does not alter businesses, reviews, favorites, profiles, or existing storage rows.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null check (char_length(trim(description)) between 1 and 1200),
  category text not null check (category in (
    'Events', 'Live Music', 'Arts & Theater', 'Sports', 'Festivals',
    'Markets', 'Community', 'Family', 'Food', 'Other'
  )),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null check (char_length(trim(location)) between 1 and 200),
  organizer text,
  price_label text,
  external_url text,
  image_url text,
  is_featured boolean not null default false,
  is_published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

-- These named constraints are applied separately so rerunning this updated
-- migration also upgrades a table created by an earlier revision.
alter table public.events
  drop constraint if exists events_organizer_length_check,
  drop constraint if exists events_price_label_length_check,
  drop constraint if exists events_external_url_check,
  drop constraint if exists events_image_url_check,
  add constraint events_organizer_length_check check (
    organizer is null or char_length(trim(organizer)) between 1 and 160
  ),
  add constraint events_price_label_length_check check (
    price_label is null or char_length(trim(price_label)) between 1 and 80
  ),
  add constraint events_external_url_check check (
    external_url is null or (
      char_length(external_url) <= 2048
      and external_url ~* '^https?://[^[:space:]]+$'
    )
  ),
  add constraint events_image_url_check check (
    image_url is null or (
      char_length(image_url) <= 2048
      and image_url ~* '^https?://[^[:space:]]+$'
    )
  );

create index if not exists events_public_schedule_idx
  on public.events (is_published, starts_at asc);
create index if not exists events_category_schedule_idx
  on public.events (category, starts_at asc);
create index if not exists events_featured_schedule_idx
  on public.events (is_featured, starts_at asc)
  where is_published;
create index if not exists events_created_by_idx
  on public.events (created_by);

-- Profile roles are the authorization source. The public sign-up flow can
-- create owners, but it never offers the trusted administrator role.
create or replace function public.is_venice_local_owner()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.is_venice_local_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- SECURITY DEFINER helpers must not retain PostgreSQL's default PUBLIC execute
-- grant. Only signed-in users need them for RLS policy evaluation.
revoke all on function public.is_venice_local_owner() from public;
revoke all on function public.is_venice_local_admin() from public;
revoke all on function public.is_venice_local_owner() from anon;
revoke all on function public.is_venice_local_admin() from anon;
grant execute on function public.is_venice_local_owner() to authenticated;
grant execute on function public.is_venice_local_admin() to authenticated;

alter table public.events enable row level security;

-- Make the API privileges explicit; RLS below still decides which rows each
-- caller may see or change.
revoke all on table public.events from anon, authenticated;
grant select on table public.events to anon, authenticated;
grant insert, update, delete on table public.events to authenticated;

drop policy if exists "Public can view published events" on public.events;
create policy "Public can view published events"
  on public.events for select to anon, authenticated
  using (is_published = true);

drop policy if exists "Owners can view own events" on public.events;
create policy "Owners can view own events"
  on public.events for select to authenticated
  using (
    public.is_venice_local_owner()
    and created_by = auth.uid()
  );

drop policy if exists "Admins can view all events" on public.events;
create policy "Admins can view all events"
  on public.events for select to authenticated
  using (public.is_venice_local_admin());

drop policy if exists "Owners can add own events" on public.events;
create policy "Owners can add own events"
  on public.events for insert to authenticated
  with check (
    public.is_venice_local_owner()
    and created_by = auth.uid()
  );

drop policy if exists "Admins can add events" on public.events;
create policy "Admins can add events"
  on public.events for insert to authenticated
  with check (
    public.is_venice_local_admin()
    and created_by = auth.uid()
  );

drop policy if exists "Owners can update own events" on public.events;
create policy "Owners can update own events"
  on public.events for update to authenticated
  using (
    public.is_venice_local_owner()
    and created_by = auth.uid()
  )
  with check (
    public.is_venice_local_owner()
    and created_by = auth.uid()
  );

drop policy if exists "Admins can update events" on public.events;
create policy "Admins can update events"
  on public.events for update to authenticated
  using (public.is_venice_local_admin())
  with check (
    public.is_venice_local_admin()
    and created_by is not null
  );

drop policy if exists "Owners can delete own events" on public.events;
create policy "Owners can delete own events"
  on public.events for delete to authenticated
  using (
    public.is_venice_local_owner()
    and created_by = auth.uid()
  );

drop policy if exists "Admins can delete events" on public.events;
create policy "Admins can delete events"
  on public.events for delete to authenticated
  using (public.is_venice_local_admin());

-- Keep updated_at current without changing existing application tables.
create or replace function public.set_events_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_events_updated_at();

-- The app uploads event images to business-media/events/<auth.uid()>/.
-- The restrictive guard keeps that ownership boundary effective even if the
-- bucket already has a broader authenticated-write policy for business media.
drop policy if exists "Admins manage event images" on storage.objects;
drop policy if exists "Event image paths stay owner scoped" on storage.objects;
drop policy if exists "Event managers upload event images" on storage.objects;
drop policy if exists "Event managers update event images" on storage.objects;
drop policy if exists "Event managers delete event images" on storage.objects;

create policy "Event image paths stay owner scoped"
  on storage.objects as restrictive for all to authenticated
  using (
    bucket_id <> 'business-media'
    or coalesce((storage.foldername(name))[1], '') <> 'events'
    or public.is_venice_local_admin()
    or (
      public.is_venice_local_owner()
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  )
  with check (
    bucket_id <> 'business-media'
    or coalesce((storage.foldername(name))[1], '') <> 'events'
    or public.is_venice_local_admin()
    or (
      public.is_venice_local_owner()
      and (storage.foldername(name))[2] = auth.uid()::text
    )
  );

create policy "Event managers upload event images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'events'
    and (
      public.is_venice_local_admin()
      or (
        public.is_venice_local_owner()
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

create policy "Event managers update event images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'events'
    and (
      public.is_venice_local_admin()
      or (
        public.is_venice_local_owner()
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  )
  with check (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'events'
    and (
      public.is_venice_local_admin()
      or (
        public.is_venice_local_owner()
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

create policy "Event managers delete event images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'events'
    and (
      public.is_venice_local_admin()
      or (
        public.is_venice_local_owner()
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );
