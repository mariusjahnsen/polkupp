#!/usr/bin/env node
/**
 * Polkupp — daglig sync fra Vinmonopolet
 *
 * Henter alle produkter fra konsument-API-en (vmpws/v2/vmp/products/search),
 * oppdaterer wines-tabellen, lagrer pris-snapshot, og logger prisnedsettelser.
 *
 * Bruk:
 *   node scripts/sync-vinmonopolet.mjs               # full sync (~1500 sider, ~5 min)
 *   node scripts/sync-vinmonopolet.mjs --max-pages=3 # test mot 3 sider (~70 produkter)
 *   node scripts/sync-vinmonopolet.mjs --dry-run     # ingen DB-skriv, bare logg
 *
 * Krever i .env.local:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (server-side, gir skrivetilgang)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// --- Konfig fra .env.local ---
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("=").map((s) => s.trim()))
    .map(([k, ...rest]) => [k, rest.join("=")])
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Mangler VITE_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY i .env.local");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const MAX_PAGES = args["max-pages"] ? parseInt(args["max-pages"], 10) : Infinity;
const DRY_RUN = !!args["dry-run"];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// --- Hjelpefunksjoner ---
const VMP_BASE = "https://www.vinmonopolet.no";
const SEARCH = `${VMP_BASE}/vmpws/v2/vmp/products/search`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Plukk årgang ut av navnet ("Penfolds x Dourthe II 2022" → 2022)
function extractYear(name) {
  const m = name?.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

// Map vmpws-produkt til wines-rad
function toWine(p) {
  return {
    vinmonopolet_id: p.code,
    name: p.name,
    category: p.main_category?.name ?? null,
    subcategory: p.main_sub_category?.name ?? null,
    country: p.main_country?.name ?? null,
    district: p.district?.name ?? null,
    year: extractYear(p.name),
    current_price: p.price?.value ?? null,
    volume_ml: p.volume?.value ? Math.round(p.volume.value * 10) : null,
    alcohol_pct: p.alcohol?.value ?? null,
    image_url:
      p.images?.find((i) => i.format === "product")?.url ??
      p.images?.[0]?.url ?? null,
    product_url: p.url ? `${VMP_BASE}${p.url}` : null,
    product_selection: p.product_selection ?? null,
    status: p.status ?? null,
    buyable: p.buyable ?? null,
    expired: p.expired ?? null,
    last_updated: new Date().toISOString(),
  };
}

// --- Hovedløkke ---
async function main() {
  console.log(`Polkupp sync — start ${new Date().toISOString()}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}, max-pages: ${MAX_PAGES === Infinity ? "alle" : MAX_PAGES}\n`);

  let page = 0;
  let totalProcessed = 0;
  let newWines = 0;
  let priceChanges = 0;
  let drops = 0;
  let totalPages = null;

  while (page < MAX_PAGES) {
    const url = `${SEARCH}?q=:relevance&pageSize=24&currentPage=${page}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Polkupp-sync/0.0.1" },
    });

    if (!res.ok) {
      console.error(`Side ${page}: HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    if (totalPages === null) {
      totalPages = data.pagination?.totalPages ?? 0;
      console.log(`Totalt ${data.pagination?.totalResults ?? "?"} produkter, ${totalPages} sider\n`);
    }

    const products = data.products ?? [];
    if (products.length === 0) break;

    const today = new Date().toISOString().slice(0, 10);

    // Filtrer bort produkter uten pris
    const valid = products.filter((p) => p.price?.value);
    const wineRows = valid.map(toWine);

    if (DRY_RUN) {
      totalProcessed += valid.length;
      page++;
      if (totalPages && page >= totalPages) break;
      continue;
    }

    // 1. Hent eksisterende rader for hele batchen i ÉTT kall
    const { data: existingRows } = await supabase
      .from("wines")
      .select("id, vinmonopolet_id, current_price")
      .in(
        "vinmonopolet_id",
        wineRows.map((w) => w.vinmonopolet_id)
      );

    const existingMap = new Map(
      (existingRows ?? []).map((r) => [r.vinmonopolet_id, r])
    );

    // 2. Detekter prisendringer + drops
    const dropRows = [];
    for (const w of wineRows) {
      const ex = existingMap.get(w.vinmonopolet_id);
      if (!ex) {
        newWines++;
        continue;
      }
      const oldP = parseFloat(ex.current_price ?? 0);
      const newP = parseFloat(w.current_price);
      if (oldP !== newP) priceChanges++;
      if (oldP > 0 && newP < oldP) {
        dropRows.push({
          wine_id: ex.id,
          drop_date: today,
          price_before: oldP,
          price_after: newP,
          pct_drop: parseFloat((((oldP - newP) / oldP) * 100).toFixed(2)),
        });
      }
    }

    // 3. Upsert hele batchen (én DB-rundtur)
    const { data: upserted, error: upsertErr } = await supabase
      .from("wines")
      .upsert(wineRows, { onConflict: "vinmonopolet_id" })
      .select("id, vinmonopolet_id, current_price");

    if (upsertErr) {
      console.error(`Upsert-feil side ${page}:`, upsertErr.message);
      page++;
      continue;
    }

    // 4. Append price_history for hele batchen (én rundtur)
    const historyRows = upserted.map((u) => ({
      wine_id: u.id,
      price: u.current_price,
    }));
    await supabase.from("price_history").insert(historyRows);

    // 5. Sett inn drops om noen (én rundtur)
    if (dropRows.length > 0) {
      await supabase
        .from("daily_drops")
        .upsert(dropRows, { onConflict: "wine_id,drop_date" });
      drops += dropRows.length;
    }

    totalProcessed += valid.length;
    page++;
    if (totalPages && page >= totalPages) break;

    if (page % 10 === 0) {
      console.log(
        `Side ${page}/${totalPages}  |  ${totalProcessed} prosessert, ${newWines} nye, ${priceChanges} prisendringer, ${drops} drops`
      );
    }

    // Vær respektfull mot Vinmonopolet — 100ms mellom kall
    await sleep(100);
  }

  console.log(
    `\nFerdig. ${totalProcessed} prosessert, ${newWines} nye, ${priceChanges} prisendringer, ${drops} drops.`
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
