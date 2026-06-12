-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New Query)
-- This script is idempotent — safe to run multiple times.

-- ── Per-user data (existing) ──────────────────────────────────
create table if not exists user_data (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users on delete cascade not null,
  key         text        not null,
  value       jsonb,
  updated_at  timestamptz default now(),
  constraint user_data_user_id_key_key unique (user_id, key)
);

alter table user_data enable row level security;

drop policy if exists "Users can manage their own data" on user_data;
create policy "Users can manage their own data"
  on user_data
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_data_user_id_key_idx on user_data (user_id, key);

-- ── Shared custom foods (visible to ALL authenticated users) ──
-- Both you and Adarsh see the same custom food database.
create table if not exists shared_foods (
  id          text        primary key,
  food        jsonb       not null,
  created_by  uuid        references auth.users on delete set null,
  created_at  timestamptz default now()
);

alter table shared_foods enable row level security;

drop policy if exists "Anyone authenticated can read shared foods" on shared_foods;
create policy "Anyone authenticated can read shared foods"
  on shared_foods for select
  using (auth.role() = 'authenticated');

drop policy if exists "Anyone authenticated can insert shared foods" on shared_foods;
create policy "Anyone authenticated can insert shared foods"
  on shared_foods for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "Anyone authenticated can update shared foods" on shared_foods;
create policy "Anyone authenticated can update shared foods"
  on shared_foods for update
  using (auth.role() = 'authenticated');

-- without a delete policy a junk custom food could never be removed
drop policy if exists "Anyone authenticated can delete shared foods" on shared_foods;
create policy "Anyone authenticated can delete shared foods"
  on shared_foods for delete
  using (auth.role() = 'authenticated');

-- ── Progress photos (PRIVATE storage — each user sees only their own) ──
-- Photos live at progress-photos/<user_id>/<date>_<ts>.jpg
insert into storage.buckets (id, name, public)
  values ('progress-photos', 'progress-photos', false)
  on conflict (id) do nothing;

drop policy if exists "Users manage own progress photos" on storage.objects;
create policy "Users manage own progress photos"
  on storage.objects for all
  using (
    bucket_id = 'progress-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'progress-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

