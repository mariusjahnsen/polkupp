-- Polkupp — initialt skjema
-- Datakilde: vinmonopolet.no/vmpws/v2/vmp/products/search (Hybris/SAP frontend API)
-- Filterer ut tilbehør, beholder vin/øl/brennevin/musserende/sider/sake/etc.

create extension if not exists "pgcrypto";

-- =========================================================
-- wines: én rad per produkt fra Vinmonopolet, oppdatert daglig
-- =========================================================
create table if not exists public.wines (
  id              uuid primary key default gen_random_uuid(),
  vinmonopolet_id text unique not null,        -- "code"-felt fra vmpws
  name            text not null,                -- "name" inkl årgang
  category        text,                         -- main_category.name (Rødvin, Hvitvin, ...)
  subcategory     text,                         -- main_sub_category.name (Bordeaux, Riesling, ...)
  country         text,                         -- main_country.name
  district        text,                         -- district.name (under-region)
  producer        text,                         -- legges til når vi henter mer detaljer
  year            int,                          -- parses ut av name når mulig
  current_price   numeric(10,2),                -- price.value i NOK
  volume_ml       int,                          -- volume.value * 10 (cl → ml)
  alcohol_pct     numeric(4,2),                 -- alcohol.value
  image_url       text,                         -- images[format=product].url
  product_url     text,                         -- prepend https://www.vinmonopolet.no
  product_selection text,                       -- Grunnsortimentet / Bestillingsutvalget / Partisalg
  status          text,                         -- aktiv / utgått / ...
  buyable         boolean,
  expired         boolean,
  last_updated    timestamptz default now()
);

create index if not exists wines_vinmonopolet_id_idx on public.wines(vinmonopolet_id);
create index if not exists wines_category_idx        on public.wines(category);
create index if not exists wines_current_price_idx   on public.wines(current_price);

-- =========================================================
-- price_history: append-only daglig snapshot per produkt
-- =========================================================
create table if not exists public.price_history (
  id          uuid primary key default gen_random_uuid(),
  wine_id     uuid not null references public.wines(id) on delete cascade,
  price       numeric(10,2) not null,
  recorded_at timestamptz not null default now()
);

create index if not exists price_history_wine_idx on public.price_history(wine_id, recorded_at desc);

-- =========================================================
-- daily_drops: én rad per dag-per-vin der prisen gikk ned
-- =========================================================
create table if not exists public.daily_drops (
  id            uuid primary key default gen_random_uuid(),
  wine_id       uuid not null references public.wines(id) on delete cascade,
  drop_date     date not null,
  price_before  numeric(10,2) not null,
  price_after   numeric(10,2) not null,
  pct_drop      numeric(5,2)  not null,          -- (before - after) / before * 100
  created_at    timestamptz not null default now(),
  unique (wine_id, drop_date)
);

create index if not exists daily_drops_drop_date_idx on public.daily_drops(drop_date desc, pct_drop desc);

-- =========================================================
-- wine_reviews: AI-genererte omtaler + Vivino-rating per vin
-- En vin kan ha mange (én per generert versjon). Frontend bruker den nyeste.
-- =========================================================
create table if not exists public.wine_reviews (
  id             uuid primary key default gen_random_uuid(),
  wine_id        uuid not null references public.wines(id) on delete cascade,
  summary        text,                          -- Claude-skrevet 2-3 setninger
  sources        jsonb,                         -- [{url, title}] fra web_search
  vivino_rating  numeric(3,2),                  -- 0.00 - 5.00 stjerner
  vivino_url     text,                          -- direkte lenke til Vivino-siden
  model_version  text,                          -- "claude-sonnet-4-5" e.l.
  generated_at   timestamptz not null default now()
);

create index if not exists wine_reviews_wine_idx on public.wine_reviews(wine_id, generated_at desc);

-- =========================================================
-- Tilgangskontroll
-- V1 er public read-only på drops + wines + reviews.
-- Vi lar Data API fungere som default (auto-expose ON i project),
-- men setter eksplisitt SELECT-grants for tydelighet.
-- =========================================================
grant select on public.wines        to anon;
grant select on public.daily_drops  to anon;
grant select on public.wine_reviews to anon;
grant select on public.price_history to anon;

-- INSERT/UPDATE skjer kun via Edge Functions med service_role-key.
