import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase.js";
import WineCard from "./components/WineCard.jsx";

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
  { code: "most_pct",  label: "Mest nedsatt %",  source: "drops",  column: "pct_drop",     asc: false },
  { code: "most_kr",   label: "Størst kr-rabatt", source: "drops", column: "price_before", asc: false }, // sorted client-side after
  { code: "newest_drop", label: "Nyeste drop",   source: "drops",  column: "drop_date",    asc: false },
  { code: "newest",    label: "Nyeste innslag",  source: "wines",  column: "last_updated", asc: false },
  { code: "price_lo",  label: "Pris lavest",     source: "wines",  column: "current_price", asc: true  },
  { code: "price_hi",  label: "Pris høyest",     source: "wines",  column: "current_price", asc: false },
];

const PAGE_SIZE = 24;
const DROP_WINDOW_DAYS = 7;

export default function App() {
  const [wines, setWines] = useState([]);
  const [dropsByWine, setDropsByWine] = useState({});
  const [reviewsByWine, setReviewsByWine] = useState({});
  const [totalCount, setTotalCount] = useState(0);
  const [hasAnyDrops, setHasAnyDrops] = useState(null); // null = ukjent, false/true = bekreftet

  const [category, setCategory] = useState(null);
  const [sort, setSort] = useState("most_pct");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const sortDef = SORTS.find((s) => s.code === sort) ?? SORTS[0];
  const sinceDate = new Date(Date.now() - DROP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  // Sjekk én gang om vi har drops i det hele tatt (avgjør empty state)
  useEffect(() => {
    (async () => {
      const { count } = await supabase
        .from("daily_drops")
        .select("id", { count: "exact", head: true })
        .gte("drop_date", sinceDate);
      setHasAnyDrops((count ?? 0) > 0);
    })();
  }, [sinceDate]);

  // Hovedquery: enten fra drops eller fra wines avhengig av sort
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        if (sortDef.source === "drops") {
          // Query daily_drops joined med wines
          let q = supabase
            .from("daily_drops")
            .select("*, wines!inner(*)", { count: "exact" })
            .gte("drop_date", sinceDate);

          if (category) q = q.eq("wines.category", category);
          if (search.trim()) q = q.ilike("wines.name", `%${search.trim()}%`);

          q = q
            .order(sortDef.column, { ascending: sortDef.asc })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

          const { data, count, error: err } = await q;
          if (cancelled) return;
          if (err) throw err;

          let rows = (data ?? []).map((d) => ({ ...d.wines, _drop: d }));

          // "Størst kr-rabatt" må sorteres client-side fordi differansen ikke
          // er en kolonne i DB (ingen generated column ennå).
          if (sort === "most_kr") {
            rows = [...rows].sort(
              (a, b) =>
                (b._drop.price_before - b._drop.price_after) -
                (a._drop.price_before - a._drop.price_after)
            );
          }

          setWines(rows);
          setTotalCount(count ?? 0);
          setDropsByWine(
            Object.fromEntries(rows.map((w) => [w.id, w._drop]))
          );
        } else {
          // Query wines, og attach drops for de synlige
          let q = supabase
            .from("wines")
            .select("*", { count: "exact" })
            .not("current_price", "is", null);

          if (category) q = q.eq("category", category);
          if (search.trim()) q = q.ilike("name", `%${search.trim()}%`);

          q = q
            .order(sortDef.column, { ascending: sortDef.asc, nullsFirst: false })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

          const { data, count, error: err } = await q;
          if (cancelled) return;
          if (err) throw err;

          const rows = data ?? [];
          setWines(rows);
          setTotalCount(count ?? 0);

          // Hent drops for synlige viner (hvis noen)
          if (rows.length > 0) {
            const ids = rows.map((w) => w.id);
            const { data: drops } = await supabase
              .from("daily_drops")
              .select("*")
              .in("wine_id", ids)
              .gte("drop_date", sinceDate)
              .order("drop_date", { ascending: false });

            // Beholder kun det nyeste dropet per vin
            const byWine = {};
            for (const d of drops ?? []) {
              if (!byWine[d.wine_id]) byWine[d.wine_id] = d;
            }
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
  }, [category, sort, search, page, sinceDate]);

  // Reviews for synlige viner
  useEffect(() => {
    const ids = wines.map((w) => w.id).filter(Boolean);
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("wine_reviews")
        .select("*")
        .in("wine_id", ids)
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

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const fmtNumber = useMemo(() => new Intl.NumberFormat("no-NO").format, []);

  const showingDrops = sortDef.source === "drops";
  const noDropsAtAll = hasAnyDrops === false;

  return (
    <main>
      <header>
        <h1>Polkupp</h1>
        <p className="tagline">Vinmonopolets prisnedsettelser, daglig.</p>
      </header>

      {/* Banner når det ikke finnes drops ennå (vanlig på dag 1) */}
      {noDropsAtAll && (
        <div className="banner">
          <strong>Ingen prisnedsettelser registrert ennå.</strong>
          {" "}
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
            {CATEGORIES.map((c) => (
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
              {SORTS.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="status error">Klarte ikke å hente data: {error}</p>}
        {loading && wines.length === 0 && <p className="status">Henter…</p>}

        {!loading && wines.length === 0 && !error && (
          <p className="status">
            {showingDrops
              ? noDropsAtAll
                ? "Ingen drops registrert ennå. Bytt sortering for å bla gjennom hele utvalget, eller vent til neste sync."
                : `Ingen drops${search ? ` for "${search}"` : ""}${category ? ` i kategori ${category}` : ""}.`
              : `Ingen treff${search ? ` for "${search}"` : ""}${category ? ` i kategori ${category}` : ""}.`}
          </p>
        )}

        {wines.length > 0 && (
          <>
            <div className="grid">
              {wines.map((w) => (
                <WineCard
                  key={w.id}
                  wine={w}
                  drop={dropsByWine[w.id]}
                  review={reviewsByWine[w.id]}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                  ← Forrige
                </button>
                <span>Side {page + 1} av {fmtNumber(totalPages)}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages}>
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
          <a href="https://www.vinmonopolet.no" target="_blank" rel="noopener noreferrer">
            vinmonopolet.no
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
