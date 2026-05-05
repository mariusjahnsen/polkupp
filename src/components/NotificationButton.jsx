import { useEffect, useState } from "react";
import { isPushSupported, notificationPermission, getCurrentSubscription, subscribe, unsubscribe } from "../lib/push.js";

export default function NotificationButton() {
  const [supported] = useState(isPushSupported());
  const [perm, setPerm] = useState(supported ? notificationPermission() : "unsupported");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!supported) return;
    (async () => {
      const sub = await getCurrentSubscription();
      setSubscribed(!!sub);
    })();
  }, [supported]);

  if (!supported) return null;

  const onToggle = async () => {
    setError(null); setBusy(true);
    try {
      if (subscribed) {
        await unsubscribe();
        setSubscribed(false);
      } else {
        await subscribe();
        setSubscribed(true);
        setPerm("granted");
      }
    } catch (e) {
      setError(e.message);
      if (e.message.includes("blokkert") || e.message.includes("Blokkert")) setPerm("denied");
    } finally {
      setBusy(false);
    }
  };

  if (perm === "denied") {
    return (
      <button className="btn-link notif-btn" disabled title="Du har blokkert varsler — slå dem på i nettlesers innstillinger">
        🔕 Varsler blokkert
      </button>
    );
  }

  const label = busy
    ? "…"
    : subscribed ? "🔔 Varsler på" : "🔔 Få varsler";

  return (
    <>
      <button className="btn-link notif-btn" onClick={onToggle} disabled={busy} aria-pressed={subscribed}>
        {label}
      </button>
      {error && <span className="notif-error" role="status">{error}</span>}
    </>
  );
}
