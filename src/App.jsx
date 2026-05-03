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
  { code: "newest",   label: "Nyeste",          column: "last_updated", asc: false },
  { code: "price_lo", label: "Pris lavest",     column: "current_price", asc: true  },
  { code: "price_hi", label: "Pris høyest",     column: "current_price", asc: false },
];

const PAGE_SIZE = 24;

export default function App() {
  // Drop-modus = viser daglige prisnedsettelser. Browse-modus = bla gjennom katalogen.
  const [drops, setDrops] = useState([]);
  const [wines, setWines] = useState([]);
  const [reviewsByWine, setReviewsByWine] = useState({});
  const [totalCount, setTotalCount] = useState(0);

  const [category, setCategory] = useState(null);
  const [sort, setSort] = useState("newest");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Hent dagens drops én gang
  useEffect(() => {
    (async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      const { data } = await supabase
        .from("daily_drops")
        .select("*, wines(*)")
        .gte("drop_date", sevenDaysAgo)
        .order("pct_drop", { ascending: false })
        .limit(40);
      setDrops(data ?? []);
    })();
  }, []);

  // Hent viner basert på filter/sort/page
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const sortDef = SORTS.find((s) => s.code === sort) ?? SORTS[0];
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
        setWines(data ?? []);
        setTotalCount(count ?? 0);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [category, sort, search, page]);

  // Hent reviews for synlige viner (drops + browse)
  useEffect(() => {
    const ids = [
      ...drops.map((d) => d.wines?.id),
      ...wines.map((w) => w.id),
    ].filter(Boolean);
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
  }, [drops, wines]);

  const onCategoryChange = (code) => { setCategory(code); setPage(0); };
  const onSortChange = (e) => { setSort(e.target.value); setPage(0); };
  const onSearchChange = (e) => { setSearch(e.target.value); setPage(0); };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const fmtNumber = useMemo(
    () => new Intl.NumberFormat("no-NO").format,
    []
  );

  return (
    <main>
      <header>
        <h1>Polkupp</h1>
        <p className="tagline">Vinmonopolets prisnedsettelser, daglig.</p>
      </header>

      {drops.length > 0 && (
        <section>
          <h2 className="section-title">Dagens drops</h2>
          <div className="grid">
            {drops.map((d) => (
              <WineCard
                key={d.id}
                wine={d.wines}
                drop={d}
                review={reviewsByWine[d.wines?.id]}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="browse-header">
          <h2 className="section-title">
            {drops.length > 0 ? "Bla gjennom utvalget" : "Hele utvalget"}
          </h2>
          <p className="count">
            {totalCount > 0 && <>Viser {wines.length} av {fmtNumber(totalCount)} viner</>}
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
        {loading && wines.length === 0 && <p className="status">Henter viner…</p>}

        {!loading && wines.length === 0 && !error && (
          <p className="status">
            Ingen treff{search ? ` for "${search}"` : ""}{category ? ` i kategori ${category}` : ""}.
          </p>
        )}

        {wines.length > 0 && (
          <>
            <div className="grid">
              {wines.map((w) => (
                <WineCard key={w.id} wine={w} review={reviewsByWine[w.id]} />
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
