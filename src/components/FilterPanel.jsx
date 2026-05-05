import { useState } from "react";

const COMMON_COUNTRIES = [
  "Frankrike", "Italia", "Spania", "USA", "Tyskland", "Argentina",
  "Chile", "Sør-Afrika", "Portugal", "Australia", "New Zealand", "Østerrike",
  "Norge", "Hellas", "Ungarn",
];

const COMMON_GRAPES = [
  "Chardonnay", "Sauvignon Blanc", "Riesling", "Pinot Grigio", "Pinot Gris",
  "Cabernet Sauvignon", "Merlot", "Pinot Noir", "Syrah", "Shiraz",
  "Tempranillo", "Sangiovese", "Nebbiolo", "Grenache", "Malbec", "Zinfandel",
  "Chenin Blanc", "Gewürztraminer", "Viognier", "Albariño",
];

const STYLES = [
  "Frisk og fruktig", "Modent og rikt", "Bløtt og bærpreget",
  "Krydret og fyldig", "Fyldig og smakrik", "Frisk og blomstrende",
];

export default function FilterPanel({ filters, onChange, onReset }) {
  const [open, setOpen] = useState(false);

  const update = (patch) => onChange({ ...filters, ...patch });
  const hasAny =
    filters.country || filters.grape || filters.style ||
    filters.priceMin != null || filters.priceMax != null ||
    filters.foodPairing;

  return (
    <details className="filter-panel" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Flere filtre
        {hasAny && <span className="filter-count">●</span>}
      </summary>
      <div className="filter-grid">
        <label>
          <span>Land</span>
          <select
            value={filters.country ?? ""}
            onChange={e => update({ country: e.target.value || null })}
          >
            <option value="">Alle</option>
            {COMMON_COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label>
          <span>Drue</span>
          <select
            value={filters.grape ?? ""}
            onChange={e => update({ grape: e.target.value || null })}
          >
            <option value="">Alle</option>
            {COMMON_GRAPES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>

        <label>
          <span>Stil</span>
          <select
            value={filters.style ?? ""}
            onChange={e => update({ style: e.target.value || null })}
          >
            <option value="">Alle</option>
            {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label>
          <span>Pris fra (kr)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="0"
            value={filters.priceMin ?? ""}
            onChange={e => update({ priceMin: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>

        <label>
          <span>Pris til (kr)</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder=""
            value={filters.priceMax ?? ""}
            onChange={e => update({ priceMax: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </label>

        <label className="full">
          <span>
            <input
              type="checkbox"
              checked={!!filters.ecoOnly}
              onChange={e => update({ ecoOnly: e.target.checked })}
            />
            Kun økologisk
          </span>
        </label>

        <label className="full">
          <span>
            <input
              type="checkbox"
              checked={!!filters.includeOrderOnly}
              onChange={e => update({ includeOrderOnly: e.target.checked })}
            />
            Vis bestillingsvarer (sjelden i butikk)
          </span>
        </label>
      </div>

      {hasAny && (
        <button className="btn-link" onClick={onReset}>Nullstill alle filtre</button>
      )}
    </details>
  );
}
