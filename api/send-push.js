// Sender push-varsel til alle aktive abonnementer.
// Kalt av sync-workflow etter en sync-kjøring som detekterte drops.
// Krever Authorization: Bearer <CRON_SECRET> for å hindre tilfeldige treff.

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

webpush.setVapidDetails(
  process.env.VAPID_CONTACT ?? "mailto:noreply@polkupp.vercel.app",
  process.env.VITE_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = req.headers.authorization ?? "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { dropsCount = 0, topDrop } = req.body ?? {};
  if (!dropsCount || dropsCount < 1) {
    return res.status(200).json({ ok: true, sent: 0, reason: "no drops to notify" });
  }

  const title = dropsCount === 1
    ? "Ny pris-drop på Polkupp"
    : `${dropsCount} nye pris-drops på Polkupp`;

  const body = topDrop
    ? `${topDrop.name}: ${topDrop.price_before} → ${topDrop.price_after} kr (-${topDrop.pct_drop}%)`
    : "Sjekk forsiden for å se hva som ble billigere i dag.";

  const payload = JSON.stringify({
    title,
    body,
    url: "/",
    tag: "polkupp-daily-drops",
  });

  // Hent alle abonnementer
  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, failed_count")
    .lt("failed_count", 5);   // hopp over chronisk failende
  if (error) return res.status(500).json({ error: error.message });

  let sent = 0, removed = 0, failed = 0;
  await Promise.all((subs ?? []).map(async (sub) => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, payload);
      sent++;
      // Reset feiltelling ved suksess
      await supabase.from("push_subscriptions")
        .update({ last_seen: new Date().toISOString(), failed_count: 0 })
        .eq("id", sub.id);
    } catch (e) {
      // 410/404 = abonnement er dødt — slett
      if (e.statusCode === 410 || e.statusCode === 404) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        removed++;
      } else {
        failed++;
        await supabase.from("push_subscriptions")
          .update({ failed_count: (sub.failed_count ?? 0) + 1 })
          .eq("id", sub.id);
      }
    }
  }));

  return res.status(200).json({ ok: true, sent, removed, failed, total: subs?.length ?? 0 });
}
