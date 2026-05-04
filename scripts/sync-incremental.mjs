#!/usr/bin/env node
/**
 * Polkupp — inkrementell daglig sync
 *
 * Bruker Vinmonopolets offisielle changedSince-API for å finne endrede produkter,
 * og scraper deretter rik produktdata fra HTML-siden (drue, smaksprofil, lagring,
 * matparing, sertifiseringer, osv.).
 *
 * Bruk:
 *   node scripts/sync-incremental.mjs                   # bruker last_sync_at fra sync_state
 *   node scripts/sync-incremental.mjs --since=2026-05-01 # overstyr cutoff
 *   node scripts/sync-incremental.mjs --max=20          # bare første N produkter (for test)
 *   node scripts/sync-incremental.mjs --dry-run         # ingen DB-skriv
 *
 * Krever i .env.local (eller env vars):
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VINMONOPOLET_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

// ----- Konfig -----
function loadEnv() {
  const fromFile = existsSync(".env.local")
    ? Object.fromEntries(
        readFileSync(".env.local", "utf8")
          .split("\n").filter(l => l && !l.startsWith("#"))
          .map(l => l.split("=").map(s => s.trim()))
          .map(([k, ...rest]) => [k, rest.join("=")])
      )
    : {};
  return { ...fromFile, ...process.env };
}
const env = loadEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;
const VMP_API_KEY  = env.VINMONOPOLET_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !VMP_API_KEY) {
  console.error("Mangler env vars. Trenger VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VINMONOPOLET_API_KEY.");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const SINCE_OVERRIDE = args.since ? String(args.since) : null;
const MAX_PRODUCTS   = args.max ? parseInt(args.max, 10) : Infinity;
const DRY_RUN        = !!args["dry-run"];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ----- Hjelpefunksjoner -----
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VMP_HOST = "https://www.vinmonopolet.no";
const APIS_HOST = "https://apis.vinmonopolet.no";

function extractYear(name) {
  const m = name?.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function parseGramPerLitre(s) {
  if (!s) return null;
  const m = String(s).replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function indexedByName(arr) {
  const map = {};
  for (const item of arr ?? []) if (item?.name) map[item.name] = item;
  return map;
}

// Henter productId-er som har endret seg siden timestamp.
// Returnerer [{productId, productShortName, lastChangedAt}].
async function fetchChangedIds(sinceIso) {
  const url = `${APIS_HOST}/products/v0/details-normal?changedSince=${encodeURIComponent(sinceIso)}`;
  const res = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": VMP_API_KEY, Accept: "application/json" } });
  if (!res.ok) throw new Error(`details-normal HTTP ${res.status}`);
  const data = await res.json();
  return (data ?? []).map(d => ({
    productId: d.basic?.productId,
    productShortName: d.basic?.productShortName,
    lastChangedAt: `${d.lastChanged?.date}T${d.lastChanged?.time}`,
  })).filter(d => d.productId);
}

// Henter rik produktdata fra HTML-siden via /p/{code} (følger 301-redirect).
async function fetchProductFromHtml(code) {
  const url = `${VMP_HOST}/p/${code}`;
  const res = await fetch(url, { headers: { "User-Agent": "Polkupp/0.1 (mariusjahnsen@gmail.com)", Accept: "text/html" } });
  if (!res.ok) throw new Error(`HTML ${res.status} for ${code}`);
  const html = await res.text();
  const scripts = [...html.matchAll(/<script type="application\/json">([\s\S]*?)<\/script>/g)];
  for (const m of scripts) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed?.product?.code === String(code)) return parsed.product;
    } catch { /* prøv neste */ }
  }
  throw new Error(`Fant ikke produkt-JSON i HTML for ${code}`);
}

// Mapper produkt-JSON fra HTML til wines-radens kolonner.
function toWineRow(p) {
  const chars = indexedByName(p.content?.characteristics);
  const traits = indexedByName(p.content?.traits);

  // Prosent ut av "Corvina 70%" i ingredients
  const grapes = (p.content?.ingredients ?? []).map(i => {
    const m = i.formattedValue?.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)%$/);
    return m
      ? { code: i.code, name: m[1].trim(), percent: parseFloat(m[2].replace(",", ".")) }
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

  // Volum-mapping: HTML har volume.value i cl, samme som vmpws.
  const volMl = p.volume?.value ? Math.round(p.volume.value * 10) : null;

  // Bilde: pick the "product"-format om mulig, ellers første
  const imageUrl = p.images?.find(i => i.format === "product")?.url ?? p.images?.[0]?.url ?? null;

  return {
    vinmonopolet_id: String(p.code),
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
    eco: p.eco ?? null,
    fair_trade: p.fairTrade ?? null,
    biodynamic: p.bioDynamic ?? null,
    gluten_free: p.gluten ?? null,
    kosher: p.kosher ?? null,
    sustainable: p.sustainable ?? null,
    environmental_packaging: p.environmentalPackaging ?? null,
    sugar_g_per_l: parseGramPerLitre(traits["Sukker"]?.formattedValue),
    acid_g_per_l: parseGramPerLitre(traits["Syre"]?.formattedValue),
    html_fetched_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
}

// ----- Hovedløp -----
async function main() {
  const startedAt = new Date().toISOString();
  console.log(`Polkupp incremental sync — start ${startedAt}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}, max-products: ${MAX_PRODUCTS === Infinity ? "alle" : MAX_PRODUCTS}\n`);

  // 1. Bestem sync-cutoff
  let sinceIso = SINCE_OVERRIDE;
  if (!sinceIso) {
    const { data: state } = await supabase.from("sync_state").select("last_sync_at").eq("id", 1).single();
    sinceIso = state?.last_sync_at;
  }
  if (!sinceIso) {
    // Fallback: gå 24 timer tilbake
    sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  }
  // changedSince forventer YYYY-MM-DDTHH:MM:SS uten Z eller millis
  const sinceClean = sinceIso.replace(/\.\d{3}Z?$/, "").replace(/Z$/, "").slice(0, 19);
  console.log(`Henter produkter endret etter: ${sinceClean}`);

  // 2. Marker sync som startet
  if (!DRY_RUN) {
    await supabase.from("sync_state").update({
      last_sync_started_at: startedAt,
      last_sync_status: "in_progress",
    }).eq("id", 1);
  }

  // 3. Hent endrede ID-er
  let changed;
  try {
    changed = await fetchChangedIds(sinceClean);
  } catch (e) {
    console.error("Fatal: kunne ikke hente changed IDs —", e.message);
    if (!DRY_RUN) await supabase.from("sync_state").update({ last_sync_status: "failed", notes: e.message }).eq("id", 1);
    process.exit(1);
  }
  console.log(`details-normal: ${changed.length} endrede produkter siden ${sinceClean}\n`);

  if (changed.length === 0) {
    console.log("Ingenting å gjøre. Avslutter.");
    if (!DRY_RUN) {
      const completedAt = new Date().toISOString();
      await supabase.from("sync_state").update({
        last_sync_at: startedAt,                 // rykk frem cutoff
        last_sync_completed_at: completedAt,
        last_sync_status: "success",
        products_changed: 0,
        products_updated: 0,
        drops_detected: 0,
        notes: null,
      }).eq("id", 1);
    }
    return;
  }

  // 4. Hent eksisterende current_price for alle endrede ID-er (én DB-rundtur)
  const allIds = changed.slice(0, MAX_PRODUCTS).map(c => c.productId);
  const { data: existingRows } = await supabase
    .from("wines").select("id, vinmonopolet_id, current_price").in("vinmonopolet_id", allIds);
  const existingByCode = new Map((existingRows ?? []).map(r => [r.vinmonopolet_id, r]));

  // 5. Loop — én HTML-call per produkt
  let processed = 0, updated = 0, drops = 0, failed = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const item of changed.slice(0, MAX_PRODUCTS)) {
    let product;
    try {
      product = await fetchProductFromHtml(item.productId);
    } catch (e) {
      failed++;
      console.warn(`  ⚠️  ${item.productId} ${item.productShortName}: ${e.message}`);
      await sleep(500);
      continue;
    }

    const wine = toWineRow(product);
    processed++;

    if (DRY_RUN) {
      console.log(`  [DRY] ${wine.vinmonopolet_id} ${wine.name} — ${wine.current_price} kr — drue: ${wine.grape_blend?.map(g => g.name).join(", ") ?? "—"}`);
      await sleep(500);
      continue;
    }

    // Upsert wine, returner id + ny pris
    const { data: upserted, error: upErr } = await supabase
      .from("wines").upsert([wine], { onConflict: "vinmonopolet_id" })
      .select("id, current_price").single();

    if (upErr) { failed++; console.warn(`  ⚠️  upsert ${wine.vinmonopolet_id}: ${upErr.message}`); await sleep(500); continue; }
    updated++;

    // Pris-snapshot
    if (wine.current_price != null) {
      await supabase.from("price_history").insert({ wine_id: upserted.id, price: wine.current_price });
    }

    // Drop-deteksjon
    const ex = existingByCode.get(wine.vinmonopolet_id);
    if (ex && ex.current_price != null && wine.current_price != null) {
      const oldP = parseFloat(ex.current_price);
      const newP = parseFloat(wine.current_price);
      if (oldP > 0 && newP < oldP) {
        const pct = parseFloat(((oldP - newP) / oldP * 100).toFixed(2));
        await supabase.from("daily_drops").upsert({
          wine_id: upserted.id, drop_date: today,
          price_before: oldP, price_after: newP, pct_drop: pct,
        }, { onConflict: "wine_id,drop_date" });
        drops++;
        console.log(`  💧 DROP ${wine.name}: ${oldP} → ${newP} kr (-${pct}%)`);
      }
    }

    if (processed % 20 === 0) {
      console.log(`  …${processed}/${Math.min(changed.length, MAX_PRODUCTS)} prosessert (${drops} drops så langt)`);
    }

    await sleep(500); // 500ms throttle = ~120 calls/min, snill mot vmpws
  }

  // 6. Oppdater sync_state
  const completedAt = new Date().toISOString();
  console.log(`\nFerdig: ${processed} prosessert, ${updated} oppdatert, ${drops} drops, ${failed} feilet.`);
  if (!DRY_RUN) {
    await supabase.from("sync_state").update({
      last_sync_at: startedAt,
      last_sync_completed_at: completedAt,
      last_sync_status: failed === 0 ? "success" : "partial",
      products_changed: changed.length,
      products_updated: updated,
      drops_detected: drops,
      notes: failed > 0 ? `${failed} produkter feilet under HTML-fetch` : null,
    }).eq("id", 1);
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
