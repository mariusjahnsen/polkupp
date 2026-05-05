-- Polkupp — push-notifikasjons-abonnementer
-- En rad per browser/device som har slått på varsler. Endpoint er unik nøkkel.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text unique not null,                  -- push-tjenestens URL fra browser
  p256dh      text not null,                         -- public key
  auth        text not null,                         -- auth-secret
  user_agent  text,                                  -- diagnostikk
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  failed_count int not null default 0                -- inkrementeres ved 410 Gone osv.
);

create index if not exists push_subscriptions_endpoint_idx on public.push_subscriptions(endpoint);

-- Anonym kan IKKE lese disse (privacy). Service-role only.
revoke all on public.push_subscriptions from anon;
