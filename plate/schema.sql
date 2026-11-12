-- Plate: the one table the app needs. Run once in the Supabase SQL editor.
-- The phone's whole state is saved as a single row. Row level security is on
-- with no policies, so only the server's secret key can read or write it.

create table if not exists public.plate_state (
  id          text primary key,
  version     bigint not null default 0,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.plate_state enable row level security;
