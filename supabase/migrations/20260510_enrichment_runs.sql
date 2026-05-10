-- Polkupp — kostnadssporing for enrichment-kjøringer
-- En rad per gang scripts/enrich-wines.mjs kjører. Brukes til ukentlig rapport.

create table if not exists public.enrichment_runs (
  id                  uuid primary key default gen_random_uuid(),
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  status              text,                          -- 'success' / 'partial' / 'failed'
  model_version       text,
  wines_processed     int  not null default 0,
  succeeded           int  not null default 0,
  failed              int  not null default 0,
  input_tokens        int  not null default 0,       -- ferske input-tokens (ikke cache)
  output_tokens       int  not null default 0,
  cache_read_tokens   int  not null default 0,
  cache_write_tokens  int  not null default 0,
  web_searches        int  not null default 0,
  estimated_cost_usd  numeric(8,4) not null default 0,
  notes               text
);

create index if not exists enrichment_runs_started_idx on public.enrichment_runs(started_at desc);

-- service-role only — kostnadsdata trenger ikke være public
revoke all on public.enrichment_runs from anon;
