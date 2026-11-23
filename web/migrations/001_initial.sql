create table if not exists units (
  id integer generated always as identity primary key,
  key text not null unique,
  label text not null,
  kind text not null,
  skill_tags jsonb not null default '[]'::jsonb,
  is_structural boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id integer generated always as identity primary key,
  owner_id text not null,
  raw_log text not null,
  source text not null default 'paste',
  focus_next_lesson text,
  parsed_payload jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now()
);
create index if not exists ix_sessions_owner on sessions (owner_id);
create index if not exists ix_sessions_ingested_at on sessions (ingested_at);

create table if not exists session_errors (
  id integer generated always as identity primary key,
  session_id integer not null references sessions (id),
  unit_id integer not null references units (id),
  raw_utterance text not null,
  corrected_utterance text not null,
  explanation text not null default '',
  is_recurring boolean not null default false
);
create index if not exists ix_session_errors_session_id on session_errors (session_id);

create table if not exists session_vocab (
  id integer generated always as identity primary key,
  session_id integer not null references sessions (id),
  unit_id integer references units (id),
  item text not null,
  example_usage text not null default '',
  used_well boolean not null default false
);

create table if not exists session_tracking (
  id integer generated always as identity primary key,
  session_id integer not null references sessions (id),
  unit_id integer references units (id),
  text text not null
);

create table if not exists unit_memories (
  owner_id text not null,
  unit_id integer not null references units (id),
  stability_days double precision not null,
  last_seen_at timestamptz,
  last_p double precision,
  last_outcome integer,
  error_count integer not null default 0,
  success_count integer not null default 0,
  is_recurring boolean not null default false,
  is_focus boolean not null default false,
  is_tracking boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, unit_id)
);
create index if not exists ix_unit_memories_updated_at on unit_memories (updated_at);

create table if not exists study_packs (
  id integer generated always as identity primary key,
  owner_id text not null,
  generated_at timestamptz not null default now(),
  budget_cards integer not null default 8,
  budget_prompts integer not null default 3,
  generator text not null default 'fallback',
  speaking_prompts jsonb not null default '[]'::jsonb
);
create index if not exists ix_study_packs_owner_generated on study_packs (owner_id, generated_at);

create table if not exists study_cards (
  id integer generated always as identity primary key,
  study_pack_id integer not null references study_packs (id),
  card_type text not null,
  prompt text not null,
  answer text not null,
  why text not null default '',
  unit_keys jsonb not null default '[]'::jsonb,
  skill_tags jsonb not null default '[]'::jsonb,
  order_index integer not null default 0
);
create index if not exists ix_study_cards_study_pack_id on study_cards (study_pack_id);

create table if not exists reviews (
  id integer generated always as identity primary key,
  owner_id text not null,
  card_id integer not null references study_cards (id),
  result text not null,
  submitted_at timestamptz not null default now(),
  p_before jsonb not null default '{}'::jsonb,
  s_before jsonb not null default '{}'::jsonb,
  s_after jsonb not null default '{}'::jsonb
);
create index if not exists ix_reviews_owner_id on reviews (owner_id);

create table if not exists rate_events (
  id integer generated always as identity primary key,
  owner_id text not null,
  route text not null,
  called_at timestamptz not null default now()
);
create index if not exists ix_rate_events_owner_route_time on rate_events (owner_id, route, called_at);
