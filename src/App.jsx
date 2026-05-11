import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase.js";
import { getLocation, clearLocation, locationLabel } from "./lib/location.js";
import WineCard from "./components/WineCard.jsx";
import FilterPanel from "./components/FilterPanel.jsx";
import LocationModal from "./components/LocationModal.jsx";
import NotificationButton from "./components/NotificationButton.jsx";

const CATEGORIES = [
  { code: null, label: "Alle" },
  { code: "Rødvin", label: "Rødvin" },
  { code: "Hvitvin", label: "Hvitvin" },
  { code: "Musserende vin", label: "Musserende" },
  { code: "Rosévin", label: "Rosé" },
  { code: "Brennevin", label: "Brennevin" },
  { code: "Øl", label: "Øl" },
];

// Drops sorteres alltid med dato først (nyeste øverst). Sekundærsort styrer
// rekkefølgen *innenfor* samme dato.
const SORTS = [
  { code: "most_pct",   label: "Mest nedsatt %",   source: "drops",  column: "pct_drop",     asc: false },
  { code: "most_kr",    label: "Størst kr-rabatt", source: "drops",  column: "price_before", asc: false },
  { code: "newest",     label: "Nyeste innslag",   source: "wines",  column: "last_updated", asc: false },
  { code: "price_lo",   label: "Pris lavest",      source: "wines",  column: "current_price",asc: true  },
  { code: "price_hi",   label: "Pris høyest",      source: "wines",  column: "current_price",asc: false },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const DEFAULT_PAGE_SIZE = 20;
const DROP_WINDOW_DAYS = 7;

function formatDropDate(dateStr) {
  if (!dateStr) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((today - target) / (24 * 3600 * 1000));
  if (diffDays === 0) return "I dag";
  if (diffDays === 1) return "I går";
  if (diffDays === 2) return "I forgårs";
  return target.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
}

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
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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
          // Dato alltid primær — nyeste drops øverst, så sekundærsortering innen dato
          q = q
            .order("drop_date", { ascending: false })
            .order(sortDef.column, { ascending: sortDef.asc })
            .range(page * pageSize, page * pageSize + pageSize - 1);

          const { data, count, error: err } = await q;
          if (cancelled) return;
          if (err) throw err;

          let rows = (data ?? []).map(d => ({ ...d.wines, _drop: d }));
          // "Størst kr-rabatt" er ikke en DB-kolonne — sorter innen hver dato-gruppe
          if (sort === "most_kr") {
            const groups = new Map();
            for (const r of rows) {
              const k = r._drop.drop_date;
              if (!groups.has(k)) groups.set(k, []);
              groups.get(k).push(r);
            }
            rows = [];
            for (const [, group] of groups) {
              group.sort(
                (a, b) =>
                  (b._drop.price_before - b._drop.price_after) -
                  (a._drop.price_before - a._drop.price_after)
              );
              rows.push(...group);
            }
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
            .range(page * pageSize, page * pageSize + pageSize - 1);

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
  }, [category, sort, search, filters, page, pageSize, sinceDate]);

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

  const onClearCache = async () => {
    if (!window.confirm("Tøm all lokal data og cache? Siden lastes på nytt. Lokasjon og varsel-abonnement nullstilles.")) return;
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith("polkupp_"))
        .forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }
    try {
      Object.keys(sessionStorage)
        .filter(k => k.startsWith("polkupp_"))
        .forEach(k => sessionStorage.removeItem(k));
    } catch { /* ignore */ }
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch { /* ignore */ }
    window.location.reload();
  };

  const totalPages = Math.ceil(totalCount / pageSize);
  const fmtNumber = useMemo(() => new Intl.NumberFormat("no-NO").format, []);
  const showingDrops = sortDef.source === "drops";
  const noDropsAtAll = hasAnyDrops === false;

  // Når vi viser drops, grupper sortert liste etter drop_date for å rendre
  // dato-headere mellom grupper. Wines-view har ingen gruppering.
  const dropGroups = useMemo(() => {
    if (!showingDrops) return null;
    const groups = [];
    for (const w of wines) {
      const date = w._drop?.drop_date;
      const last = groups[groups.length - 1];
      if (!last || last.date !== date) groups.push({ date, wines: [w] });
      else last.wines.push(w);
    }
    return groups;
  }, [showingDrops, wines]);

  return (
    <main>
      <header>
        <div className="header-top">
          <a
            href="/"
            className="logo-link"
            onClick={(e) => {
              if (window.location.pathname === "/") {
                e.preventDefault();
                setCategory(null);
                setSort("most_pct");
                setSearch("");
                setFilters(EMPTY_FILTERS);
                setPage(0);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          >
            <h1>Polkupp</h1>
            <p className="tagline">Vinmonopolets prisnedsettelser, oppdatert daglig.</p>
          </a>
          <div className="header-actions">
            <NotificationButton />
            <button className="btn-link location-btn" onClick={() => setShowLocationModal(true)}>
              📍 {locationLabel(location)}
            </button>
          </div>
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
            {showingDrops && !noDropsAtAll ? "Siste drops" : "Hele utvalget"}
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
            {showingDrops && dropGroups ? (
              dropGroups.map(g => (
                <Fragment key={g.date}>
                  <h3 className="date-header">{formatDropDate(g.date)}</h3>
                  <div className="grid">
                    {g.wines.map(w => (
                      <WineCard
                        key={`${w.id}-${w._drop?.drop_date ?? "x"}`}
                        wine={w}
                        drop={w._drop ?? dropsByWine[w.id]}
                        review={reviewsByWine[w.id]}
                        location={location}
                        onAskLocation={askLocation}
                      />
                    ))}
                  </div>
                </Fragment>
              ))
            ) : (
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
            )}

            <div className="pagination">
              <div className="page-size">
                <label>
                  Per side:&nbsp;
                  <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}>
                    {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
              {totalPages > 1 && (
                <div className="page-nav">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                    ← Forrige
                  </button>
                  <span>Side {page + 1} av {fmtNumber(totalPages)}</span>
                  <button onClick={() => setPage(p => p + 1)} disabled={page + 1 >= totalPages}>
                    Neste →
                  </button>
                </div>
              )}
            </div>
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
          {" · "}
          <button className="btn-link inline tiny" onClick={onClearCache} title="Tøm all lokal data og cache">
            Tøm cache
          </button>
        </p>
        <p className="signature">Laget av Mise</p>
      </footer>

      {showLocationModal && (
        <LocationModal onChosen={onLocationChosen} onClose={onLocationClose} />
      )}
    </main>
  );
}
