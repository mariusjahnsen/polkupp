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

    for (const p of products) {
      if (!p.price?.value) continue; // hopp over uten pris

      const wineRow = toWine(p);

      if (DRY_RUN) {
        totalProcessed++;
        continue;
      }

      // Hent eksisterende rad (om noen) for å diffe pris
      const { data: existing } = await supabase
        .from("wines")
        .select("id, current_price")
        .eq("vinmonopolet_id", p.code)
        .maybeSingle();

      let wineId;

      if (existing) {
        wineId = existing.id;
        const oldPrice = parseFloat(existing.current_price ?? 0);
        const newPrice = parseFloat(wineRow.current_price);

        if (oldPrice !== newPrice) priceChanges++;

        // Prisnedsettelse?
        if (oldPrice > 0 && newPrice < oldPrice) {
          const pctDrop = ((oldPrice - newPrice) / oldPrice) * 100;
          await supabase.from("daily_drops").upsert(
            {
              wine_id: wineId,
              drop_date: today,
              price_before: oldPrice,
              price_after: newPrice,
              pct_drop: parseFloat(pctDrop.toFixed(2)),
            },
            { onConflict: "wine_id,drop_date" }
          );
          drops++;
        }

        await supabase.from("wines").update(wineRow).eq("id", wineId);
      } else {
        const { data: inserted, error } = await supabase
          .from("wines")
          .insert(wineRow)
          .select("id")
          .single();
        if (error) {
          console.error(`Insert-feil for ${p.code}:`, error.message);
          continue;
        }
        wineId = inserted.id;
        newWines++;
      }

      // Append snapshot i price_history
      await supabase.from("price_history").insert({
        wine_id: wineId,
        price: wineRow.current_price,
      });

      totalProcessed++;
    }

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
