export default function WineCard({ wine, drop, review }) {
  const priceFmt = (p) =>
    new Intl.NumberFormat("no-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: p % 1 === 0 ? 0 : 2,
    }).format(p);

  return (
    <article className="wine-card">
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
      </div>
    </article>
  );
}
