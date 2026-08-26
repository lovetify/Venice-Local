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

create index if not exists events_public_schedule_idx
  on public.events (is_published, starts_at asc);
create index if not exists events_category_schedule_idx
  on public.events (category, starts_at asc);
create index if not exists events_featured_schedule_idx
  on public.events (is_featured, starts_at asc)
  where is_published;

-- The existing profile role is the authorization source. Assign role = 'admin'
-- to trusted administrators in Supabase; the public sign-up UI never offers it.
create or replace function public.is_venice_local_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_venice_local_admin() to anon, authenticated;

alter table public.events enable row level security;

drop policy if exists "Public can view published events" on public.events;
create policy "Public can view published events"
  on public.events for select
  using (is_published = true);

drop policy if exists "Admins can view all events" on public.events;
create policy "Admins can view all events"
  on public.events for select to authenticated
  using (public.is_venice_local_admin());

drop policy if exists "Admins can add events" on public.events;
create policy "Admins can add events"
  on public.events for insert to authenticated
  with check (public.is_venice_local_admin() and created_by = auth.uid());

drop policy if exists "Admins can update events" on public.events;
create policy "Admins can update events"
  on public.events for update to authenticated
  using (public.is_venice_local_admin())
  with check (public.is_venice_local_admin());

drop policy if exists "Admins can delete events" on public.events;
create policy "Admins can delete events"
  on public.events for delete to authenticated
  using (public.is_venice_local_admin());

-- Keep updated_at current without changing existing application tables.
create or replace function public.set_events_updated_at()
returns trigger
language plpgsql
set search_path = public
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

-- The app stores event images in the existing business-media bucket under events/.
-- These policies are deliberately limited to that folder and to profile admins.
drop policy if exists "Admins manage event images" on storage.objects;
create policy "Admins manage event images"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'events'
    and public.is_venice_local_admin()
  )
  with check (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] = 'events'
    and public.is_venice_local_admin()
  );
