import { useEffect, useState } from "react";

const CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(wineCode, location) {
  return `polkupp_stock_${wineCode}_${location.type}_${location.postnr ?? `${location.lat},${location.lon}`}`;
}

function locationParams(location) {
  if (location.type === "gps") return `latitude=${location.lat}&longitude=${location.lon}`;
  return `location=${encodeURIComponent(location.postnr)}`;
}

export default function StoreList({ wineCode, location }) {
  const [stores, setStores] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!wineCode || !location) return;
    let cancelled = false;

    const key = cacheKey(wineCode, location);
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL_MS) {
          setStores(data);
          return;
        }
      }
    } catch { /* ignore */ }

    setStores(null);
    setError(null);

    (async () => {
      try {
        const url = `https://www.vinmonopolet.no/vmpws/v2/vmp/products/${wineCode}/stock?${locationParams(location)}&pageSize=10`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const list = data.stores ?? [];
        if (cancelled) return;
        setStores(list);
        try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: list })); } catch {}
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();

    return () => { cancelled = true; };
  }, [wineCode, location?.type, location?.postnr, location?.lat, location?.lon]);

  if (error) return <p className="stock-status error">Klarte ikke å hente lager: {error}</p>;
  if (stores === null) return <p className="stock-status">Henter butikker…</p>;
  if (stores.length === 0) return <p className="stock-status">Ingen butikker har den på lager nå.</p>;

  return (
    <ul className="store-list">
      {stores.map(s => {
        const pos = s.pointOfService;
        return (
          <li key={pos.id}>
            <span className="store-name">{pos.displayName}</span>
            <span className="store-distance">{pos.formattedDistance}</span>
            <span className="store-stock">{s.stockInfo?.stockLevel ?? "?"} stk</span>
          </li>
        );
      })}
    </ul>
  );
}
