-- Polkupp — utvider wines med data fra Vinmonopolets produkt-HTML
-- Datakilde: scraping av JSON embedded i product-page HTML (script type="application/json")
-- Alle nye kolonner er nullable for å ikke bryte eksisterende 36k rader.

-- =========================================================
-- wines: nye kolonner for rik produktdata
-- =========================================================
alter table public.wines
  add column if not exists grape_blend          jsonb,         -- [{code, name, percent}]
  add column if not exists flavor_profile       jsonb,         -- {fylde, friskhet, garvestoffer, sodme, bitterhet}
  add column if not exists style_code           text,
  add column if not exists style_name           text,          -- "Frisk og fruktig"
  add column if not exists style_description    text,
  add column if not exists food_pairing         jsonb,         -- [{code, name}]
  add column if not exists storage_potential    text,          -- "Drikkeklar nå, men kan også lagres"
  add column if not exists color                text,          -- "Mørk rød."
  add column if not exists smell                text,
  add column if not exists taste                text,
  add column if not exists summary              text,
  add column if not exists method               text,
  add column if not exists allergens            text,
  add column if not exists distributor          text,
  add column if not exists wholesaler           text,
  add column if not exists sub_district         text,
  add column if not exists eco                  boolean,
  add column if not exists fair_trade           boolean,
  add column if not exists biodynamic           boolean,
  add column if not exists gluten_free          boolean,
  add column if not exists kosher               boolean,
  add column if not exists sustainable          boolean,
  add column if not exists environmental_packaging boolean,
  add column if not exists sugar_g_per_l        numeric(6,2),
  add column if not exists acid_g_per_l         numeric(6,2),
  add column if not exists html_fetched_at      timestamptz;

-- Indekser for filtrering — bruk GIN på jsonb for "contains"-spørringer
create index if not exists wines_grape_blend_idx       on public.wines using gin (grape_blend);
create index if not exists wines_food_pairing_idx      on public.wines using gin (food_pairing);
create index if not exists wines_country_idx           on public.wines (country);
create index if not exists wines_style_name_idx        on public.wines (style_name);
create index if not exists wines_storage_potential_idx on public.wines (storage_potential);

-- =========================================================
-- sync_state: én rad som holder kursen for inkrementell sync
-- =========================================================
create table if not exists public.sync_state (
  id                       smallint primary key default 1,
  last_sync_at             timestamptz,                       -- pass denne som changedSince
  last_sync_started_at     timestamptz,
  last_sync_completed_at   timestamptz,
  last_sync_status         text,                              -- 'success' / 'partial' / 'failed'
  products_changed         int,                               -- hvor mange details-normal returnerte
  products_updated         int,                               -- hvor mange wines-rader vi rakk å oppdatere
  drops_detected           int,
  notes                    text,
  constraint sync_state_singleton check (id = 1)
);

-- Initial rad så vi kan upserte uten ugly INSERT-OR-UPDATE
insert into public.sync_state (id, last_sync_at)
values (1, '2026-05-03 19:00:00+00')   -- siste known-good sync (dag 2)
on conflict (id) do nothing;

grant select on public.sync_state to anon;
