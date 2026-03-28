-- Stores Expo push tokens for server-side notifications.
-- One row per (user, token) pair; upsert to handle reinstalls/token refresh.
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists idx_push_tokens_user_id on push_tokens(user_id);

alter table push_tokens enable row level security;

create policy "Users can manage their own push tokens"
  on push_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
