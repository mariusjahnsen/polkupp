#!/usr/bin/env node
/**
 * Polkupp — backfill av eksisterende wines med rik HTML-data
 *
 * Kjører gjennom alle wines som mangler html_fetched_at, henter HTML,
 * parser og oppdaterer rad. Resume-vennlig (kjør flere ganger til alt er gjort).
 *
 * Bruk:
 *   node scripts/backfill-html.mjs --max=500              # backfill første 500 viner
 *   node scripts/backfill-html.mjs --max=500 --order=price  # de dyreste først
 *   node scripts/backfill-html.mjs --dry-run --max=5
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function loadEnv() {
  const fromFile = existsSync(".env.local")
    ? Object.fromEntries(
        readFileSync(".env.local", "utf8")
          .split("\n").filter(l => l && !l.startsWith("#"))
          .map(l => l.split("=").map(s => s.trim()))
          .map(([k, ...rest]) => [k, rest.join("=")])
      ) : {};
  return { ...fromFile, ...process.env };
}
const env = loadEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Mangler env vars"); process.exit(1); }

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true];
}));
const MAX     = args.max ? parseInt(args.max, 10) : 500;
const DRY_RUN = !!args["dry-run"];
const ORDER   = args.order || "price";  // "price" (dyreste først) eller "id" (vilkårlig)

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VMP_HOST = "https://www.vinmonopolet.no";

// ---- Parser (samme som sync-incremental.mjs) ----
function indexedByName(arr) { const m = {}; for (const i of arr ?? []) if (i?.name) m[i.name] = i; return m; }
function parseGramPerLitre(s) { if (!s) return null; const m = String(s).replace(",", ".").match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; }
function extractYear(name) { const m = name?.match(/\b(19|20)\d{2}\b/); return m ? parseInt(m[0], 10) : null; }

async function fetchProductFromHtml(code) {
  const res = await fetch(`${VMP_HOST}/p/${code}`, { headers: { "User-Agent": "Polkupp/0.1 (mariusjahnsen@gmail.com)", Accept: "text/html" } });
  if (res.status === 429) {
    // Cloudflare throttle — abort hele kjøringen, retry-after kan være timer
    const retryAfter = res.headers.get("retry-after");
    const e = new Error(`HTTP 429 (retry-after: ${retryAfter}s) — IP throttled, avbryter`);
    e.fatal = true;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const scripts = [...html.matchAll(/<script type="application\/json">([\s\S]*?)<\/script>/g)];
  for (const m of scripts) {
    try { const p = JSON.parse(m[1]); if (p?.product?.code === String(code)) return p.product; } catch {}
  }
  throw new Error("Ingen produkt-JSON i HTML");
}

function toWineRow(p) {
  const chars = indexedByName(p.content?.characteristics);
  const traits = indexedByName(p.content?.traits);
  const grapes = (p.content?.ingredients ?? []).map(i => {
    const m = i.formattedValue?.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)%$/);
    return m ? { code: i.code, name: m[1].trim(), percent: parseFloat(m[2].replace(",", ".")) }
             : { code: i.code, name: (i.formattedValue ?? "").trim(), percent: null };
  });
  const profile = {};
  for (const key of ["Fylde", "Friskhet", "Garvestoffer", "Sødme", "Bitterhet", "Soedme"]) {
    if (chars[key]?.value != null) {
      const k = key === "Soedme" ? "Sødme" : key;
      profile[k.toLowerCase()] = parseInt(chars[key].value, 10);
    }
  }
  const alcoholRaw = traits["Alkohol"]?.value ?? p.alcohol?.value ?? null;
  const alcoholNum = alcoholRaw != null ? parseFloat(String(alcoholRaw).replace(",", ".")) : null;
  const volMl = p.volume?.value ? Math.round(p.volume.value * 10) : null;
  const imageUrl = p.images?.find(i => i.format === "product")?.url ?? p.images?.[0]?.url ?? null;

  return {
    name: p.name,
    category: p.main_category?.name ?? null,
    subcategory: p.main_sub_category?.name ?? null,
    country: p.main_country?.name ?? null,
    district: p.district?.name ?? null,
    sub_district: p.sub_District?.name ?? null,
    producer: p.main_producer?.name ?? null,
    wholesaler: p.main_wholesaler?.name ?? p.wholeSaler?.name ?? null,
    distributor: typeof p.distributor === "string" ? p.distributor : (p.distributor?.name ?? null),
    year: extractYear(p.name),
    current_price: p.price?.value ?? null,
    volume_ml: volMl,
    alcohol_pct: alcoholNum,
    image_url: imageUrl,
    product_url: p.url ? `${VMP_HOST}${p.url}` : `${VMP_HOST}/p/${p.code}`,
    product_selection: p.product_selection ?? null,
    status: p.status ?? null,
    buyable: p.buyable ?? null,
    expired: p.expired ?? null,
    grape_blend: grapes.length ? grapes : null,
    flavor_profile: Object.keys(profile).length ? profile : null,
    style_code: p.content?.style?.code ?? null,
    style_name: p.content?.style?.name ?? null,
    style_description: p.content?.style?.description ?? null,
    food_pairing: p.content?.isGoodFor ?? null,
    storage_potential: p.content?.storagePotential?.formattedValue ?? null,
    color: p.color ?? null,
    smell: p.smell ?? null,
    taste: p.taste ?? null,
    summary: p.summary ?? null,
    method: p.method ?? null,
    allergens: p.allergens ?? null,
    eco: p.eco ?? null, fair_trade: p.fairTrade ?? null, biodynamic: p.bioDynamic ?? null,
    gluten_free: p.gluten ?? null, kosher: p.kosher ?? null, sustainable: p.sustainable ?? null,
    environmental_packaging: p.environmentalPackaging ?? null,
    sugar_g_per_l: parseGramPerLitre(traits["Sukker"]?.formattedValue),
    acid_g_per_l: parseGramPerLitre(traits["Syre"]?.formattedValue),
    html_fetched_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
}

// ---- Hovedløp ----
async function main() {
  console.log(`Backfill start. Max: ${MAX}, order: ${ORDER}, dry-run: ${DRY_RUN}\n`);

  const orderColumn = ORDER === "price" ? "current_price" : "id";
  const { data: targets, error } = await supabase
    .from("wines").select("id, vinmonopolet_id, name, current_price")
    .is("html_fetched_at", null)
    .not("current_price", "is", null)
    .order(orderColumn, { ascending: false, nullsFirst: false })
    .limit(MAX);
  if (error) { console.error("Query error:", error.message); process.exit(1); }

  // Hvor mange totalt mangler?
  const { count: remaining } = await supabase.from("wines")
    .select("id", { count: "exact", head: true })
    .is("html_fetched_at", null);
  console.log(`Totalt ${remaining} viner mangler html_fetched_at. Tar ${targets.length} denne kjøringen.\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < targets.length; i++) {
    const w = targets[i];
    try {
      const product = await fetchProductFromHtml(w.vinmonopolet_id);
      const row = toWineRow(product);
      if (!DRY_RUN) {
        const { error: upErr } = await supabase.from("wines").update(row).eq("id", w.id);
        if (upErr) throw upErr;
      }
      ok++;
      if (ok % 25 === 0 || ok === targets.length) {
        console.log(`  ${ok}/${targets.length} (${fail} feil) — sist: ${w.name?.slice(0,60)}`);
      }
    } catch (e) {
      fail++;
      console.warn(`  ⚠️  ${w.vinmonopolet_id} ${w.name?.slice(0,40)}: ${e.message}`);
      if (e.fatal) {
        console.error("\nFatalt: avbryter backfill pga IP-throttle. Vent på cool-down eller kjør fra annen IP.");
        break;
      }
    }
    await sleep(2000);  // 2s throttle — under tid for å være snill mot Cloudflare på vinmonopolet.no
  }

  console.log(`\nFerdig: ${ok} oppdatert, ${fail} feilet av ${targets.length} forsøk.`);
  console.log(`Ca. ${remaining - ok} gjenstår — kjør igjen for å fortsette.`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
