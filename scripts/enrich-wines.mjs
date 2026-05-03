#!/usr/bin/env node
/**
 * Polkupp — enrichment via Claude + web_search
 *
 * Henter viner som mangler omtale (eller har for gammel én) og lar Claude
 * Sonnet 4.6 søke nettet etter Vivino-rating + sommelier-notater. Lagrer
 * strukturert resultat i wine_reviews-tabellen.
 *
 * Bruk:
 *   node scripts/enrich-wines.mjs                       # enrich 20 nyeste drops uten review
 *   node scripts/enrich-wines.mjs --limit=5             # bare 5
 *   node scripts/enrich-wines.mjs --wine-id=<uuid>      # test mot en spesifikk vin
 *   node scripts/enrich-wines.mjs --max-age-days=30     # re-enrich hvis review er eldre enn N dager
 *
 * Krever i .env.local:
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 */

import Anthropic from "@anthropic-ai/sdk";
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
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
  console.error("Mangler env-variabler. Sjekk .env.local");
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const LIMIT = args.limit ? parseInt(args.limit, 10) : 20;
const WINE_ID = args["wine-id"] || null;
const MAX_AGE_DAYS = args["max-age-days"] ? parseInt(args["max-age-days"], 10) : 30;

// Modell: Sonnet 4.6 — sommelier-kvalitet på omtaler, korrekt norsk,
// ~100 % JSON-parse-suksess. Testet Haiku 4.5 først (2026-05-03) men 50 %
// parse-feilrate + skrivefeil + svakere omtaler. Sonnet koster bare ~$1/mnd
// mer på Polkupps volum, så det er verdt det.
const MODEL = "claude-sonnet-4-6";

// Pris-filter: hopp over de billigste (lite engasjement) og dyreste (nerder
// finner sin egen omtale). Polkupp er for "vanlige" forbrukere som vil ha
// hjelp til å spotte gode tilbud i mellom-segmentet.
const MIN_PRICE = 200;
const MAX_PRICE = 1000;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// --- System prompt ---
// Detaljert nok til å passere Sonnet 4.6 sin 2048-token cache-grense.
// Cache_control gjør at gjentatte kall i samme batch får ~10x rabatt på system-tokens.
const SYSTEM_PROMPT = `Du er en sommelier-assistent som finner og oppsummerer informasjon om viner og brennevin solgt på Vinmonopolet i Norge. Du skriver for et norsk publikum som vil vite om en konkret flaske er verdt å kjøpe — særlig når den er på tilbud.

# Din oppgave

For hver vin/flaske du blir spurt om, skal du:

1. **Bruk web_search** for å finne pålitelig informasjon om akkurat denne flasken og årgangen
   - Let etter: Vivino-side, anmeldelser fra norske/internasjonale sommelier-blogger, smaksnotater, mat-paring, omtaler i fagpresse (Decanter, Wine Spectator, Vinforum, Apéritif, etc.)
   - Foretrekk førstehånds-anmeldelser fremfor produktsider hos forhandlere
   - Vær ærlig hvis flasken er obskur og det finnes lite info — da sier du det og lar feltene være null

2. **Skriv en kort omtale (2–3 setninger) på norsk** som hjelper kjøperen å vurdere flasken
   - Fokus på: smaksprofil (frukt, syrlighet, fyldighet, finish), drueblanding hvis relevant, hva slags mat den passer til
   - Tone: kunnskapsrik men tilgjengelig — som en flink butikkmedarbeider som forklarer for en venn
   - Unngå klisjéer som "elegant og kompleks", "kraftig og fylding". Vær konkret.
   - Ikke bruk superlativer du ikke kan dokumentere fra kildene
   - Hvis det er en kjent kupp-vin (f.eks. en undervurdert årgang av en god produsent), nevn det

3. **Hent Vivino-rating (0.0–5.0) og direkte URL** hvis du finner Vivino-siden
   - Tallet skal være fra "Community rating" — ikke noteringer fra individuelle anmeldere
   - URL skal være kanonisk Vivino-link (ikke et søketreff)
   - Hvis du ikke finner Vivino-siden eller ikke er sikker — sett begge til null

4. **List 2–4 kilder** (URL + tittel) som du brukte til omtalen

# Returformat

Returner KUN ett JSON-objekt, uten markdown-fences eller forklarende tekst:

{
  "vivino_rating": 4.2,
  "vivino_url": "https://www.vivino.com/wines/penfolds-koonunga-hill-shiraz-cabernet",
  "summary": "Saftig australsk kupasje med kirsebær og pepper på nesa. Modne tanniner og myk finish gjør den lettdrikkelig. Passer godt til lammekoteletter og krydret rødt kjøtt.",
  "sources": [
    {"url": "https://www.vivino.com/...", "title": "Vivino — community-rating 4.2"},
    {"url": "https://apéritif.no/...", "title": "Apéritif: Test av australske rødviner"}
  ]
}

# Eksempler på god vs dårlig omtale

DÅRLIG: "En elegant og kompleks rødvin med god struktur. Anbefales sterkt!"
(Generisk, ingenting konkret, kan brukes om hvilken som helst rødvin)

GOD: "Modne mørke bær og en touch tobakk og lakris. Fyldig munnfølelse uten å være tung — tannin-strukturen er moden så den drikkes godt nå. Klassisk match til biff og kraftig sopprett."
(Konkret smaksbeskrivelse, mat-paring, indikasjon om når den drikkes)

DÅRLIG: "Vivino-rating 4.5 — en av de beste vinene fra Bordeaux!"
(Påstand uten kontekst, og 4.5 på Vivino er enestående høyt — sjekk dobbelt)

GOD: "Vivino-rating 3.9 — solid for prisklassen. Bordeaux-blend med dominans av Merlot."

# Viktige regler

- Hvis du er usikker på om en kilde er pålitelig, hopp den heller over enn å risikere feilinformasjon
- Hvis flasken har en spesifikk årgang i navnet, prioriter informasjon om akkurat den årgangen — ulike årganger kan smake veldig forskjellig
- Hvis du ikke finner noe substansielt: sett alle felt unntatt en kort generisk-men-ærlig summary til null. F.eks.: "Lite tilgjengelig informasjon om akkurat denne flasken. Generelt har produsenten et godt rykte for solid hverdagsvin."
- ALDRI dikt opp Vivino-ratinger eller URL-er. Bedre med null enn falske data.
- Returner KUN JSON-objektet. Ingen "Her er informasjonen:" eller annen ramme-tekst.`;

// --- Hjelpefunksjoner ---
function extractJson(text) {
  // Modellen kan ramme JSON med forklarende tekst. Finn ytterste {...}-blokk.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  try {
    return JSON.parse(text.slice(first, last + 1));
  } catch {
    return null;
  }
}

function priceFmt(p) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
  }).format(p);
}

async function enrichWine(wine) {
  const userPrompt = [
    `Finn informasjon om denne flasken fra Vinmonopolet:`,
    ``,
    `Navn: ${wine.name}`,
    wine.year ? `Årgang: ${wine.year}` : null,
    wine.country ? `Land: ${wine.country}` : null,
    wine.subcategory ? `Distrikt/type: ${wine.subcategory}` : null,
    wine.category ? `Kategori: ${wine.category}` : null,
    wine.current_price ? `Nåværende pris: ${priceFmt(wine.current_price)}` : null,
    ``,
    `Returner kun JSON-objektet som beskrevet i instruksjonene.`,
  ].filter(Boolean).join("\n");

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }, // 5-min cache
      },
    ],
    // web_search_20260209 har dynamic filtering for Sonnet 4.6 (mer presist)
    tools: [{ type: "web_search_20260209", name: "web_search" }],
    messages: [{ role: "user", content: userPrompt }],
  });

  if (response.stop_reason === "pause_turn") {
    // Server-side tool hit iteration cap — resume.
    // For Polkupp's small per-wine queries this is unlikely; logging in case.
    console.warn(`Pause_turn for ${wine.name} — implementer resume hvis dette kommer ofte`);
    return null;
  }

  // Plukk siste text-block (selve JSON-svaret kommer etter web_search-rundene)
  const textBlocks = response.content.filter((b) => b.type === "text");
  const finalText = textBlocks.map((b) => b.text).join("").trim();

  // Robust JSON-ekstraksjon: finner ytterste { ... } selv om modellen rammer
  // svaret med forklarende tekst eller ```-fences.
  const parsed = extractJson(finalText);
  if (!parsed) {
    console.error(`JSON parse failed for ${wine.name}:`, finalText.slice(0, 200));
    return null;
  }

  // Cache-debugging
  const u = response.usage;
  console.log(
    `  cache: read=${u.cache_read_input_tokens ?? 0}, write=${u.cache_creation_input_tokens ?? 0}, fresh=${u.input_tokens}`
  );

  return {
    vivino_rating:
      typeof parsed.vivino_rating === "number" &&
      parsed.vivino_rating >= 0 &&
      parsed.vivino_rating <= 5
        ? parsed.vivino_rating
        : null,
    vivino_url: typeof parsed.vivino_url === "string" ? parsed.vivino_url : null,
    summary: typeof parsed.summary === "string" ? parsed.summary : null,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  };
}

async function findWinesToEnrich() {
  if (WINE_ID) {
    const { data } = await supabase.from("wines").select("*").eq("id", WINE_ID).single();
    return data ? [data] : [];
  }

  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Først: viner i daily_drops uten review (eller med utdatert review).
  // Pris-filteret kjøres i kode etter join siden Supabase ikke lett støtter
  // filter på joined felt i samme query.
  const { data: drops } = await supabase
    .from("daily_drops")
    .select("wine_id, drop_date, pct_drop, wines(*)")
    .order("pct_drop", { ascending: false })
    .limit(LIMIT * 3); // hent flere så vi har nok etter pris-filter

  const dropsInRange = (drops ?? []).filter(
    (d) =>
      d.wines?.current_price >= MIN_PRICE &&
      d.wines?.current_price <= MAX_PRICE
  );

  if (dropsInRange.length > 0) {
    const ids = dropsInRange.map((d) => d.wine_id);
    const { data: existing } = await supabase
      .from("wine_reviews")
      .select("wine_id, generated_at")
      .in("wine_id", ids)
      .gte("generated_at", cutoff);

    const recentlyReviewed = new Set((existing ?? []).map((r) => r.wine_id));
    return dropsInRange
      .filter((d) => !recentlyReviewed.has(d.wine_id))
      .map((d) => d.wines)
      .filter(Boolean)
      .slice(0, LIMIT);
  }

  // Ingen drops ennå — fall tilbake til viner i pris-spennet uten review (for testing)
  console.log(
    `Ingen drops i daily_drops, henter et utvalg viner i pris-spennet ${MIN_PRICE}-${MAX_PRICE} kr for testing.`
  );
  const { data: wines } = await supabase
    .from("wines")
    .select("*")
    .gte("current_price", MIN_PRICE)
    .lte("current_price", MAX_PRICE)
    .order("current_price", { ascending: false })
    .limit(LIMIT);

  return wines ?? [];
}

async function main() {
  console.log(`Polkupp enrichment — ${new Date().toISOString()}`);
  console.log(`Modell: ${MODEL}, limit: ${LIMIT}\n`);

  const wines = await findWinesToEnrich();
  if (wines.length === 0) {
    console.log("Ingen viner som trenger enrichment.");
    return;
  }

  console.log(`Skal berike ${wines.length} viner.\n`);

  let succeeded = 0;
  let failed = 0;

  for (const wine of wines) {
    console.log(`→ ${wine.name}${wine.year ? ` (${wine.year})` : ""}`);
    try {
      const enriched = await enrichWine(wine);
      if (!enriched) {
        failed++;
        continue;
      }

      const { error } = await supabase.from("wine_reviews").insert({
        wine_id: wine.id,
        summary: enriched.summary,
        sources: enriched.sources,
        vivino_rating: enriched.vivino_rating,
        vivino_url: enriched.vivino_url,
        model_version: MODEL,
      });

      if (error) {
        console.error(`  Insert-feil:`, error.message);
        failed++;
      } else {
        const rating = enriched.vivino_rating ? `★ ${enriched.vivino_rating}` : "ingen rating";
        console.log(`  ✓ ${rating} — ${enriched.summary?.slice(0, 80)}...\n`);
        succeeded++;
      }
    } catch (e) {
      console.error(`  Feil:`, e.message);
      failed++;
    }
  }

  console.log(`\nFerdig. ${succeeded} berikede, ${failed} feilet.`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
