import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase.js";
import WineCard from "./components/WineCard.jsx";

export default function App() {
  const [drops, setDrops] = useState([]);
  const [recent, setRecent] = useState([]);
  const [reviewsByWine, setReviewsByWine] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // 1. Dagens prisnedsettelser (siste 7 dager)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);

        const { data: dropRows } = await supabase
          .from("daily_drops")
          .select("*, wines(*)")
          .gte("drop_date", sevenDaysAgo)
          .order("pct_drop", { ascending: false })
          .limit(40);

        setDrops(dropRows ?? []);

        // 2. Hvis ingen drops ennå: vis nyeste innslag som teaser
        if (!dropRows || dropRows.length === 0) {
          const { data: recentRows } = await supabase
            .from("wines")
            .select("*")
            .not("current_price", "is", null)
            .order("last_updated", { ascending: false })
            .limit(24);
          setRecent(recentRows ?? []);
        }

        // 3. Plukk siste review per vin (når vi har dem)
        const wineIds = [
          ...(dropRows?.map((d) => d.wines?.id) ?? []),
          ...(recent?.map((r) => r.id) ?? []),
        ].filter(Boolean);

        if (wineIds.length > 0) {
          const { data: reviewRows } = await supabase
            .from("wine_reviews")
            .select("*")
            .in("wine_id", wineIds)
            .order("generated_at", { ascending: false });

          if (reviewRows) {
            const byWine = {};
            for (const r of reviewRows) {
              if (!byWine[r.wine_id]) byWine[r.wine_id] = r;
            }
            setReviewsByWine(byWine);
          }
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main>
      <header>
        <h1>Polkupp</h1>
        <p className="tagline">Vinmonopolets prisnedsettelser, daglig.</p>
      </header>

      {loading && <p className="status">Henter dagens kupp…</p>}
      {error && <p className="status error">Klarte ikke å hente data: {error}</p>}

      {!loading && drops.length > 0 && (
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

      {!loading && drops.length === 0 && recent.length > 0 && (
        <section>
          <h2 className="section-title">Innlasting pågår</h2>
          <p className="explainer">
            Database-en bygges nå. Prisnedsettelser detekteres fra og med neste
            sync-runde — vi sammenligner morgendagens priser mot dagens for å finne kuppene.
            I mellomtiden er her et utvalg av varene som er kommet inn:
          </p>
          <div className="grid">
            {recent.map((w) => (
              <WineCard key={w.id} wine={w} review={reviewsByWine[w.id]} />
            ))}
          </div>
        </section>
      )}

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
