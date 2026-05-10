#!/usr/bin/env node
/**
 * Polkupp — ukentlig kostnadsrapport
 *
 * Aggregerer alle enrichment_runs siste 7 dager og leverer rapporten:
 *   1. Som GitHub Actions step summary (synlig i Actions-fanen)
 *   2. Som push-varsel via /api/send-push (hvis SITE_URL + CRON_SECRET er satt)
 *
 * Bruk:
 *   node scripts/weekly-cost-report.mjs           # full rapport, send push
 *   node scripts/weekly-cost-report.mjs --no-push # bare logg, ikke send
 *
 * Krever:
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SITE_URL, CRON_SECRET (for push-leveranse)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, appendFileSync } from "node:fs";

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
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Mangler VITE_SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const NO_PUSH = !!args["no-push"];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function main() {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: runs, error } = await supabase
    .from("enrichment_runs")
    .select("*")
    .gte("started_at", since)
    .order("started_at", { ascending: true });
  if (error) { console.error("DB-feil:", error.message); process.exit(1); }

  const totalRuns = runs?.length ?? 0;
  const successfulRuns = (runs ?? []).filter(r => r.status === "success").length;
  const partialRuns = (runs ?? []).filter(r => r.status === "partial").length;
  const failedRuns = (runs ?? []).filter(r => r.status === "failed").length;
  const totalWines = (runs ?? []).reduce((s, r) => s + (r.succeeded ?? 0), 0);
  const totalCost = (runs ?? []).reduce((s, r) => s + parseFloat(r.estimated_cost_usd ?? 0), 0);
  const totalSearches = (runs ?? []).reduce((s, r) => s + (r.web_searches ?? 0), 0);
  const costPerWine = totalWines > 0 ? totalCost / totalWines : 0;

  // Konsoll-rapport
  console.log(`\n=== Polkupp ukentlig rapport — ${new Date().toISOString().slice(0, 10)} ===`);
  console.log(`Periode: siste 7 dager (siden ${since.slice(0, 10)})`);
  console.log(`Kjøringer: ${totalRuns} (${successfulRuns} suksess, ${partialRuns} partial, ${failedRuns} failed)`);
  console.log(`Viner berikede: ${totalWines}`);
  console.log(`Web-søk: ${totalSearches}`);
  console.log(`Estimert kostnad: $${totalCost.toFixed(2)}`);
  console.log(`Snitt per vin: $${costPerWine.toFixed(4)}`);
  console.log(`Estimert månedsrate: $${(totalCost * 30 / 7).toFixed(2)}`);

  // GitHub Actions step summary
  if (env.GITHUB_STEP_SUMMARY) {
    const md = [
      `## Polkupp ukentlig kostnadsrapport`,
      `Periode: siste 7 dager (siden ${since.slice(0, 10)})`,
      ``,
      `| Metrikk | Verdi |`,
      `| --- | ---: |`,
      `| Kjøringer | ${totalRuns} |`,
      `| Vellykkede | ${successfulRuns} |`,
      `| Partial / failed | ${partialRuns} / ${failedRuns} |`,
      `| Viner berikede | ${totalWines} |`,
      `| Web-søk totalt | ${totalSearches} |`,
      `| **Estimert kostnad** | **$${totalCost.toFixed(2)}** |`,
      `| Snitt per vin | $${costPerWine.toFixed(4)} |`,
      `| Månedsrate (estimert) | $${(totalCost * 30 / 7).toFixed(2)} |`,
      ``,
    ].join("\n");
    appendFileSync(env.GITHUB_STEP_SUMMARY, md);
    console.log("Skrev rapport til GITHUB_STEP_SUMMARY.");
  }

  // Push-varsel
  if (!NO_PUSH && env.SITE_URL && env.CRON_SECRET) {
    const body = totalRuns === 0
      ? "Ingen enrichment-kjøringer siste uke."
      : `${totalWines} viner berikede, $${totalCost.toFixed(2)} (snitt $${costPerWine.toFixed(3)}/vin)`;
    try {
      const res = await fetch(`${env.SITE_URL}/api/send-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          customTitle: "Polkupp ukerapport",
          customBody: body,
          customTag: "polkupp-weekly-report",
          url: "/",
        }),
      });
      const result = await res.json().catch(() => ({}));
      console.log(`Push: sendt=${result.sent ?? 0}, fjernet=${result.removed ?? 0}, feilet=${result.failed ?? 0}`);
    } catch (e) {
      console.warn(`Push-varsel feilet: ${e.message}`);
    }
  } else if (NO_PUSH) {
    console.log("--no-push satt, hopper over push-varsel.");
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
