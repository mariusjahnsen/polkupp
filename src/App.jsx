import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase.js";
import { getLocation, clearLocation, locationLabel } from "./lib/location.js";
import WineCard from "./components/WineCard.jsx";
import FilterPanel from "./components/FilterPanel.jsx";
import LocationModal from "./components/LocationModal.jsx";

const CATEGORIES = [
  { code: null, label: "Alle" },
  { code: "Rødvin", label: "Rødvin" },
  { code: "Hvitvin", label: "Hvitvin" },
  { code: "Musserende vin", label: "Musserende" },
  { code: "Rosévin", label: "Rosé" },
  { code: "Brennevin", label: "Brennevin" },
  { code: "Øl", label: "Øl" },
];

const SORTS = [
  { code: "most_pct",   label: "Mest nedsatt %",   source: "drops",  column: "pct_drop",     asc: false },
  { code: "most_kr",    label: "Størst kr-rabatt", source: "drops",  column: "price_before", asc: false },
  { code: "newest_drop",label: "Nyeste drop",      source: "drops",  column: "drop_date",    asc: false },
  { code: "newest",     label: "Nyeste innslag",   source: "wines",  column: "last_updated", asc: false },
  { code: "price_lo",   label: "Pris lavest",      source: "wines",  column: "current_price",asc: true  },
  { code: "price_hi",   label: "Pris høyest",      source: "wines",  column: "current_price",asc: false },
];

const PAGE_SIZE = 24;
const DROP_WINDOW_DAYS = 7;

const EMPTY_FILTERS = {
  country: null, grape: null, style: null,
  priceMin: null, priceMax: null, ecoOnly: false, foodPairing: null,
  includeOrderOnly: false,  // Bestillingsvarer skjules som standard — sjelden i butikk
};

export default function App() {
  const [wines, setWines] = useState([]);
  const [dropsByWine, setDropsByWine] = useState({});
  const [reviewsByWine, setReviewsByWine] = useState({});
  const [totalCount, setTotalCount] = useState(0);
  const [hasAnyDrops, setHasAnyDrops] = useState(null);

  const [category, setCategory] = useState(null);
  const [sort, setSort] = useState("most_pct");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Lokasjon (lager-i-butikk)
  const [location, setLocationState] = useState(getLocation());
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [locationCallback, setLocationCallback] = useState(null);

  const sortDef = SORTS.find(s => s.code === sort) ?? SORTS[0];
  const sinceDate = new Date(Date.now() - DROP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  // Sjekk om det finnes drops i det hele tatt
  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from("daily_drops")
        .select("id", { count: "exact", head: true })
        .gte("drop_date", sinceDate);
      setHasAnyDrops((count ?? 0) > 0);
    })();
  }, [sinceDate]);

  // Hovedquery
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const applyWineFilters = (q, prefix = "") => {
          const c = (col) => prefix + col;
          if (category) q = q.eq(c("category"), category);
          if (search.trim()) q = q.ilike(c("name"), `%${search.trim()}%`);
          if (filters.country) q = q.eq(c("country"), filters.country);
          if (filters.style) q = q.eq(c("style_name"), filters.style);
          if (filters.priceMin != null) q = q.gte(c("current_price"), filters.priceMin);
          if (filters.priceMax != null) q = q.lte(c("current_price"), filters.priceMax);
          if (filters.ecoOnly) q = q.eq(c("eco"), true);
          if (filters.grape) q = q.contains(c("grape_blend"), [{ name: filters.grape }]);
          if (!filters.includeOrderOnly) q = q.neq(c("product_selection"), "Bestillingsutvalget");
          return q;
        };

        if (sortDef.source === "drops") {
          let q = supabase
            .from("daily_drops")
            .select("*, wines!inner(*)", { count: "exact" })
            .gte("drop_date", sinceDate);
          q = applyWineFilters(q, "wines.");
          q = q
            .order(sortDef.column, { ascending: sortDef.asc })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

          const { data, count, error: err } = await q;
          if (cancelled) return;
          if (err) throw err;

          let rows = (data ?? []).map(d => ({ ...d.wines, _drop: d }));
          if (sort === "most_kr") {
            rows = [...rows].sort(
              (a, b) =>
                (b._drop.price_before - b._drop.price_after) -
                (a._drop.price_before - a._drop.price_after)
            );
          }
          setWines(rows);
          setTotalCount(count ?? 0);
          setDropsByWine(Object.fromEntries(rows.map(w => [w.id, w._drop])));
        } else {
          let q = supabase
            .from("wines")
            .select("*", { count: "exact" })
            .not("current_price", "is", null);
          q = applyWineFilters(q);
          q = q
            .order(sortDef.column, { ascending: sortDef.asc, nullsFirst: false })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

          const { data, count, error: err } = await q;
          if (cancelled) return;
          if (err) throw err;

          const rows = data ?? [];
          setWines(rows);
          setTotalCount(count ?? 0);

          if (rows.length > 0) {
            const ids = rows.map(w => w.id);
            const { data: drops } = await supabase
              .from("daily_drops").select("*").in("wine_id", ids)
              .gte("drop_date", sinceDate)
              .order("drop_date", { ascending: false });
            const byWine = {};
            for (const d of drops ?? []) if (!byWine[d.wine_id]) byWine[d.wine_id] = d;
            setDropsByWine(byWine);
          } else {
            setDropsByWine({});
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [category, sort, search, filters, page, sinceDate]);

  // Reviews for synlige viner
  useEffect(() => {
    const ids = wines.map(w => w.id).filter(Boolean);
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("wine_reviews").select("*").in("wine_id", ids)
        .order("generated_at", { ascending: false });
      if (!data) return;
      const byWine = {};
      for (const r of data) if (!byWine[r.wine_id]) byWine[r.wine_id] = r;
      setReviewsByWine(byWine);
    })();
  }, [wines]);

  const onCategoryChange = (code) => { setCategory(code); setPage(0); };
  const onSortChange = (e) => { setSort(e.target.value); setPage(0); };
  const onSearchChange = (e) => { setSearch(e.target.value); setPage(0); };
  const onFiltersChange = (next) => { setFilters(next); setPage(0); };
  const resetFilters = () => { setFilters(EMPTY_FILTERS); setPage(0); };

  const askLocation = (cb) => {
    setLocationCallback(() => cb);
    setShowLocationModal(true);
  };
  const onLocationChosen = (loc) => {
    setLocationState(loc);
    setShowLocationModal(false);
    if (locationCallback) {
      locationCallback();
      setLocationCallback(null);
    }
  };
  const onLocationClose = () => {
    setShowLocationModal(false);
    setLocationCallback(null);
  };
  const onClearLocation = () => {
    clearLocation();
    setLocationState(null);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const fmtNumber = useMemo(() => new Intl.NumberFormat("no-NO").format, []);
  const showingDrops = sortDef.source === "drops";
  const noDropsAtAll = hasAnyDrops === false;

  return (
    <main>
      <header>
        <div className="header-top">
          <div>
            <h1>Polkupp</h1>
            <p className="tagline">Vinmonopolets prisnedsettelser, daglig.</p>
          </div>
          <button className="btn-link location-btn" onClick={() => setShowLocationModal(true)}>
            📍 {locationLabel(location)}
          </button>
        </div>
      </header>

      {noDropsAtAll && (
        <div className="banner">
          <strong>Ingen prisnedsettelser registrert ennå.</strong>{" "}
          Polkupp sammenligner Vinmonopolets priser fra dag til dag — første drops dukker opp etter neste sync (om morgenen).
          Bla gjennom utvalget under i mellomtiden.
        </div>
      )}

      <section>
        <div className="browse-header">
          <h2 className="section-title">
            {showingDrops && !noDropsAtAll ? "Dagens drops" : "Hele utvalget"}
          </h2>
          <p className="count">
            {totalCount > 0 && (
              <>Viser {wines.length} av {fmtNumber(totalCount)}{showingDrops ? " drops" : " viner"}</>
            )}
          </p>
        </div>

        <div className="filters">
          <div className="category-tabs">
            {CATEGORIES.map(c => (
              <button
                key={c.code ?? "all"}
                className={category === c.code ? "tab active" : "tab"}
                onClick={() => onCategoryChange(c.code)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="filter-controls">
            <input
              type="search"
              placeholder="Søk på navn…"
              value={search}
              onChange={onSearchChange}
            />
            <select value={sort} onChange={onSortChange}>
              {SORTS.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </div>
          <FilterPanel filters={filters} onChange={onFiltersChange} onReset={resetFilters} />
        </div>

        {error && <p className="status error">Klarte ikke å hente data: {error}</p>}
        {loading && wines.length === 0 && <p className="status">Henter…</p>}

        {!loading && wines.length === 0 && !error && (
          <p className="status">
            {showingDrops
              ? noDropsAtAll
                ? "Ingen drops registrert ennå. Bytt sortering for å bla gjennom hele utvalget."
                : "Ingen drops matcher dine filtre."
              : "Ingen treff. Prøv å nullstille filtrene."}
            {!filters.includeOrderOnly && (
              <> Bestillingsvarer er skjult — slå dem på i «Flere filtre» for å se hele utvalget.</>
            )}
          </p>
        )}

        {wines.length > 0 && (
          <>
            <div className="grid">
              {wines.map(w => (
                <WineCard
                  key={w.id}
                  wine={w}
                  drop={dropsByWine[w.id]}
                  review={reviewsByWine[w.id]}
                  location={location}
                  onAskLocation={askLocation}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                  ← Forrige
                </button>
                <span>Side {page + 1} av {fmtNumber(totalPages)}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={page + 1 >= totalPages}>
                  Neste →
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <footer>
        <p>
          Polkupp er et hobbyprosjekt. Ikke tilknyttet Vinmonopolet. Data hentet fra{" "}
          <a href="https://www.vinmonopolet.no" target="_blank" rel="noopener noreferrer">vinmonopolet.no</a>.
          {location && (
            <> · <button className="btn-link inline" onClick={onClearLocation}>Glem lokasjon</button></>
          )}
        </p>
      </footer>

      {showLocationModal && (
        <LocationModal onChosen={onLocationChosen} onClose={onLocationClose} />
      )}
    </main>
  );
}
