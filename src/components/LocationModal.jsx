import { useState } from "react";
import { getGpsLocation, setLocation } from "../lib/location.js";

export default function LocationModal({ onChosen, onClose }) {
  const [postnr, setPostnr] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const tryGps = async () => {
    console.log("[Polkupp DEBUG] tryGps START");
    setError(null); setBusy(true);
    try {
      console.log("[Polkupp DEBUG] calling getGpsLocation");
      const loc = await getGpsLocation();
      console.log("[Polkupp DEBUG] got location:", loc);
      setLocation(loc);
      console.log("[Polkupp DEBUG] saved to localStorage, calling onChosen");
      onChosen(loc);
      console.log("[Polkupp DEBUG] onChosen returned");
    } catch (e) {
      console.error("[Polkupp DEBUG] tryGps catch:", e);
      setError(e.message);
    } finally {
      console.log("[Polkupp DEBUG] tryGps finally, busy=false");
      setBusy(false);
    }
  };

  const tryPostnr = (e) => {
    e.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(postnr)) { setError("Skriv inn et 4-sifret postnummer"); return; }
    const loc = { type: "postnr", postnr };
    setLocation(loc);
    onChosen(loc);
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="locmodal-title">
        <h3 id="locmodal-title">Hvor er du?</h3>
        <p className="modal-lead">
          Vi bruker dette for å vise hvilke Vinmonopol nær deg som har vinen på lager.
          Lagres bare i din nettleser.
        </p>

        <button className="btn-primary" onClick={tryGps} disabled={busy}>
          {busy ? "Henter posisjon…" : "📍 Bruk min posisjon"}
        </button>

        <div className="or-divider"><span>eller</span></div>

        <form onSubmit={tryPostnr} className="postnr-form">
          <input
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="Postnummer"
            value={postnr}
            onChange={e => setPostnr(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button type="submit" className="btn-primary" disabled={postnr.length !== 4}>
            Bruk dette
          </button>
        </form>

        {error && <p className="modal-error">{error}</p>}

        <button className="btn-link" onClick={onClose}>Avbryt</button>
      </div>
    </div>
  );
}
