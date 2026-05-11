import { useEffect, useRef, useState } from "react";
import StoreList from "./StoreList.jsx";

export default function WineCard({ wine, drop, review, location, onAskLocation }) {
  const [showStores, setShowStores] = useState(false);
  const cardRef = useRef(null);
  const autoShownRef = useRef(false);

  // Auto-vis lager når kortet ruller inn i viewport (kun én gang per sesjon
  // per kort, så bruker som skjuler manuelt forblir skjult).
  useEffect(() => {
    if (!location || autoShownRef.current) return;
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          autoShownRef.current = true;
          setShowStores(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" }   // forhåndshent like før kortet er synlig
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [location]);

  const priceFmt = (p) =>
    new Intl.NumberFormat("no-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: p % 1 === 0 ? 0 : 2,
    }).format(p);

  const onClickStores = () => {
    if (!location) {
      onAskLocation(() => {
        autoShownRef.current = true;   // hindre at observer re-aktiverer
        setShowStores(true);
      });
      return;
    }
    setShowStores(s => !s);
  };

  const grapeStr = wine.grape_blend?.length
    ? wine.grape_blend
        .map(g => `${g.name}${g.percent ? ` ${g.percent}%` : ""}`)
        .join(" · ")
    : null;

  return (
    <article className="wine-card" ref={cardRef}>
      {wine.image_url && (
        <a href={wine.product_url} target="_blank" rel="noopener noreferrer" className="wine-image-wrap">
          <img src={wine.image_url} alt={wine.name} loading="lazy" />
        </a>
      )}

      <div className="wine-meta">
        <h2>
          <a href={wine.product_url} target="_blank" rel="noopener noreferrer">
            {wine.name}
          </a>
        </h2>
        <p className="wine-tags">
          {[wine.category, wine.country, wine.subcategory].filter(Boolean).join(" · ")}
        </p>

        {grapeStr && <p className="wine-grapes">{grapeStr}</p>}

        {wine.style_name && (
          <p className="wine-style" title={wine.style_description}>
            <em>{wine.style_name}</em>
          </p>
        )}

        {drop ? (
          <p className="price drop">
            <s>{priceFmt(drop.price_before)}</s>
            <span className="price-after">{priceFmt(drop.price_after)}</span>
            <span className="pct">−{drop.pct_drop.toFixed(1)} %</span>
          </p>
        ) : (
          <p className="price">{priceFmt(wine.current_price)}</p>
        )}

        {review?.summary && <p className="review">{review.summary}</p>}

        {review?.vivino_rating != null && (
          <p className="vivino">
            <span aria-label="Vivino-rating">★ {review.vivino_rating.toFixed(1)}</span>
            {review.vivino_url && (
              <a href={review.vivino_url} target="_blank" rel="noopener noreferrer">
                Vivino
              </a>
            )}
          </p>
        )}

        <button
          className="store-btn"
          onClick={onClickStores}
          aria-expanded={showStores}
        >
          {showStores ? "Skjul lager" : "📍 Lager i nærheten"}
        </button>

        {showStores && location && (
          <StoreList wineCode={wine.vinmonopolet_id} location={location} />
        )}
      </div>
    </article>
  );
}
