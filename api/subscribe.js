// Lagrer eller fjerner et push-abonnement i Supabase.
// POST   /api/subscribe — { endpoint, keys: { p256dh, auth } } → 201
// DELETE /api/subscribe — { endpoint } → 204

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { endpoint, keys } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: "Mangler endpoint eller keys" });
    }
    const { error } = await supabase.from("push_subscriptions").upsert({
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: req.headers["user-agent"]?.slice(0, 200) ?? null,
      last_seen: new Date().toISOString(),
      failed_count: 0,
    }, { onConflict: "endpoint" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true });
  }

  if (req.method === "DELETE") {
    const { endpoint } = req.body ?? {};
    if (!endpoint) return res.status(400).json({ error: "Mangler endpoint" });
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: "Method not allowed" });
}
