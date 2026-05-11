-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New Query)

create table if not exists user_data (
  id          uuid        default gen_random_uuid() primary key,
  user_id     uuid        references auth.users on delete cascade not null,
  key         text        not null,
  value       jsonb,
  updated_at  timestamptz default now(),
  constraint user_data_user_id_key_key unique (user_id, key)
);

-- Row Level Security: users can only see/edit their own data
alter table user_data enable row level security;

create policy "Users can manage their own data"
  on user_data
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Optional: index for fast lookups
create index if not exists user_data_user_id_key_idx on user_data (user_id, key);
