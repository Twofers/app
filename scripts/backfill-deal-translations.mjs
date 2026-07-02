#!/usr/bin/env node
// Deterministic backfill for deals published without es/ko/en translations.
//
// Fills ONLY empty title_/description_ locale columns using the same
// deterministic localized-offer renderer the app uses at publish time
// (lib/deal-translation-fallback.ts). Never overwrites existing translations
// and never calls an AI provider, so it costs nothing and uses no quota.
//
// Usage:
//   node scripts/backfill-deal-translations.mjs                 # dry run (default)
//   node scripts/backfill-deal-translations.mjs --apply         # write updates
//   node scripts/backfill-deal-translations.mjs --business <id> # limit to one business
//   node scripts/backfill-deal-translations.mjs --self-test     # offline renderer check
//
// Credentials: reads EXPO_PUBLIC_SUPABASE_URL from .env. Writing requires
// SUPABASE_SERVICE_ROLE_KEY in the process environment (deals RLS blocks
// cross-owner updates). Dry runs work with the anon key + smoke login the
// other probe scripts use.

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  const env = {};
  try {
    const text = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
    }
  } catch {
    /* .env optional for --self-test */
  }
  return env;
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const SELF_TEST = args.includes("--self-test");
const businessFlagIndex = args.indexOf("--business");
const BUSINESS_ID = businessFlagIndex >= 0 ? args[businessFlagIndex + 1] : null;

const DEAL_COLUMNS = [
  "id",
  "business_id",
  "title",
  "description",
  "source_locale",
  "title_en",
  "title_es",
  "title_ko",
  "description_en",
  "description_es",
  "description_ko",
  "deal_type",
  "applies_to",
  "discount_percent",
  "item_description",
  "item_retail_value_cents",
  "required_purchase_quantity",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_quantity",
  "free_item_description",
  "free_item_retail_value_cents",
  "free_item_discount_percent",
  "customer_value_percent",
  "max_claims",
  "start_time",
  "end_time",
  "timezone",
].join(",");

// The renderer lives in TypeScript shared with the app; bundle it on the fly
// so this script and the publish path can never drift apart.
async function loadRenderer() {
  const esbuild = await import("esbuild");
  const outDir = mkdtempSync(path.join(tmpdir(), "twofer-backfill-"));
  const outFile = path.join(outDir, "renderer-bundle.mjs");
  await esbuild.build({
    absWorkingDir: REPO_ROOT,
    stdin: {
      contents: [
        'export { buildDealTranslationFallback } from "./lib/deal-translation-fallback";',
        'export { buildOfferDefinitionFromDealDisplay } from "./lib/localized-deal-display";',
      ].join("\n"),
      resolveDir: REPO_ROOT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    outfile: outFile,
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outFile).href);
  return {
    mod,
    cleanup: () => {
      try {
        rmSync(outDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

function normalizeSourceLocale(value) {
  const lang = typeof value === "string" ? value.trim().toLowerCase().split("-")[0] : "";
  return lang === "es" || lang === "ko" ? lang : "en";
}

function blank(value) {
  return typeof value !== "string" || value.trim() === "";
}

function missingLocales(deal) {
  const missing = [];
  for (const locale of ["en", "es", "ko"]) {
    if (blank(deal[`title_${locale}`])) missing.push(locale);
  }
  return missing;
}

function buildUpdate(mod, deal) {
  const sourceLocale = normalizeSourceLocale(deal.source_locale);
  const offerDefinition = mod.buildOfferDefinitionFromDealDisplay(deal);
  const fallback = mod.buildDealTranslationFallback({
    source_locale: sourceLocale,
    title: typeof deal.title === "string" ? deal.title : "",
    description: typeof deal.description === "string" ? deal.description : "",
    offerDefinition,
  });

  const update = {};
  for (const locale of ["en", "es", "ko"]) {
    if (blank(deal[`title_${locale}`]) && !blank(fallback[`title_${locale}`])) {
      update[`title_${locale}`] = fallback[`title_${locale}`];
    }
    if (blank(deal[`description_${locale}`]) && !blank(fallback[`description_${locale}`])) {
      update[`description_${locale}`] = fallback[`description_${locale}`];
    }
  }
  if (blank(deal.source_locale) && Object.keys(update).length > 0) {
    update.source_locale = sourceLocale;
  }
  return { update, usedOfferDefinition: Boolean(offerDefinition) };
}

async function selfTest(mod) {
  const sample = {
    id: "self-test",
    title: "Get 40% off one large iced tea",
    description: "Show this deal at the counter.",
    source_locale: "en",
    title_en: "Get 40% off one large iced tea",
    title_es: "",
    title_ko: "",
    deal_type: "PERCENT_OFF_SINGLE_ITEM",
    applies_to: "SINGLE_ITEM",
    discount_percent: 40,
    item_description: "large iced tea",
    businesses: { name: "Test Cafe" },
  };
  const { update, usedOfferDefinition } = buildUpdate(mod, sample);
  console.log("Self-test offer definition built:", usedOfferDefinition);
  console.log("Self-test update:", JSON.stringify(update, null, 2));
  const ok = usedOfferDefinition && !blank(update.title_es) && !blank(update.title_ko);
  if (!ok) {
    console.error("SELF-TEST FAILED: expected non-empty es/ko titles.");
    process.exit(1);
  }
  console.log("SELF-TEST PASSED");
}

async function main() {
  const { mod, cleanup } = await loadRenderer();
  try {
    if (SELF_TEST) {
      await selfTest(mod);
      return;
    }

    const env = loadDotEnv();
    const url = env.EXPO_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    const apiKey = serviceKey || anonKey;
    if (!url || !apiKey) {
      console.error("Missing EXPO_PUBLIC_SUPABASE_URL (.env) or API key.");
      process.exit(2);
    }
    if (APPLY && !serviceKey) {
      console.error("--apply requires SUPABASE_SERVICE_ROLE_KEY in the environment.");
      process.exit(2);
    }

    // Anon cannot read `businesses`; dry runs without the service key sign in
    // with the local smoke account (same pattern as probe-strong-deal.mjs).
    let bearer = apiKey;
    if (!serviceKey) {
      const smokeEmail = env.TWOFER_SMOKE_EMAIL;
      const smokePassword = env.TWOFER_SMOKE_PASSWORD;
      if (!smokeEmail || !smokePassword) {
        console.error("Dry run needs TWOFER_SMOKE_EMAIL / TWOFER_SMOKE_PASSWORD in .env (or SUPABASE_SERVICE_ROLE_KEY).");
        process.exit(2);
      }
      const authRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: smokeEmail, password: smokePassword }),
      });
      const authBody = await authRes.json().catch(() => ({}));
      if (!authRes.ok || !authBody.access_token) {
        console.error(`Smoke sign-in failed: HTTP ${authRes.status}`);
        process.exit(2);
      }
      bearer = authBody.access_token;
    }

    const headers = {
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    };
    const filters = ["or=(title_es.is.null,title_es.eq.,title_ko.is.null,title_ko.eq.,title_en.is.null,title_en.eq.)"];
    if (BUSINESS_ID) filters.push(`business_id=eq.${encodeURIComponent(BUSINESS_ID)}`);
    const listUrl =
      `${url}/rest/v1/deals?select=${encodeURIComponent(`${DEAL_COLUMNS},businesses(name,address,location)`)}` +
      `&${filters.join("&")}&order=created_at.desc&limit=500`;
    const res = await fetch(listUrl, { headers });
    if (!res.ok) {
      console.error(`Deal fetch failed: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      process.exit(1);
    }
    const deals = await res.json();
    console.log(`Found ${deals.length} deal(s) with at least one empty translation column.`);

    let planned = 0;
    let applied = 0;
    let skipped = 0;
    for (const deal of deals) {
      const { update, usedOfferDefinition } = buildUpdate(mod, deal);
      const fields = Object.keys(update);
      if (fields.length === 0) {
        skipped += 1;
        console.log(`- ${deal.id} SKIP (no deterministic rendering possible; missing: ${missingLocales(deal).join(",") || "none"})`);
        continue;
      }
      planned += 1;
      console.log(
        `- ${deal.id} ${APPLY ? "APPLY" : "PLAN"} [${usedOfferDefinition ? "renderer" : "source-only"}] ` +
          `sets: ${fields.join(", ")}`,
      );
      for (const field of fields.filter((f) => f.startsWith("title_"))) {
        console.log(`    ${field}: ${update[field]}`);
      }
      if (!APPLY) continue;
      const patchRes = await fetch(`${url}/rest/v1/deals?id=eq.${encodeURIComponent(deal.id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(update),
      });
      if (!patchRes.ok) {
        console.error(`  UPDATE FAILED: HTTP ${patchRes.status}: ${(await patchRes.text()).slice(0, 300)}`);
      } else {
        applied += 1;
      }
    }

    console.log(
      `\nDone. planned=${planned} applied=${applied} skipped=${skipped} mode=${APPLY ? "apply" : "dry-run"}`,
    );
    if (!APPLY && planned > 0) {
      console.log("Re-run with --apply and SUPABASE_SERVICE_ROLE_KEY to write these updates.");
    }
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error("backfill-deal-translations failed:", err?.message ?? err);
  process.exit(1);
});
