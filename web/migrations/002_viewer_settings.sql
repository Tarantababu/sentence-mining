create table if not exists viewer_settings (
  owner_id text primary key,
  openai_api_key text,
  updated_at timestamptz not null default now()
);
