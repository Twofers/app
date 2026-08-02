#!/usr/bin/env node
/**
 * Post-build, pre-deploy step for the Twofer website. Run between
 * `vercel build` and `vercel deploy --prebuilt`.
 *
 * WHY THIS EXISTS
 * Vercel resolves static files before any vercel.json redirect or rewrite
 * runs. A static `s/index.html` therefore claims EVERY `/s/<code>` request and
 * the share code never reaches the routing layer at all (a loose diagnostic
 * redirect proved the router sees the literal path `/s/index.html`). That is
 * why deal-specific link unfurls silently served the generic card.
 *
 * The fix is to keep `/s/*` unclaimed in the deployment so the rewrites reach
 * api/share-preview, which serves the very same markup from an inlined copy of
 * the template (api/_share-template.js, byte-checked by check-share-preview).
 *
 * website/s/index.html stays in the repo: it is the canonical source for the
 * inlined copy, for local `python -m http.server`, and for the local harnesses
 * in check-website-ui-crawl.js / e2e-smoke.js, which map /s/* to it themselves.
 *
 * This script refuses to prune unless the share-preview function is actually
 * present in the build output, so it can never ship a site where /s/* 404s.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(SITE_ROOT, ".vercel", "output");
const STATIC_SHARE_DIR = path.join(OUTPUT, "static", "s");
const FUNCTION_DIR = path.join(OUTPUT, "functions", "api", "share-preview.func");

function fail(message) {
  console.error(`prepare-deploy FAILED: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(OUTPUT)) {
  fail("no .vercel/output - run `npx vercel build --prod --yes` first.");
}

// Guard 1: the function that will serve /s/* must exist in this build.
if (!fs.existsSync(FUNCTION_DIR)) {
  fail(`${path.relative(SITE_ROOT, FUNCTION_DIR)} missing - refusing to prune the static share page.`);
}

// Guard 2: the function must carry the inlined template, since it no longer
// has a static file to fall back on.
const inlined = path.join(SITE_ROOT, "api", "_share-template.js");
if (!fs.existsSync(inlined)) {
  fail("api/_share-template.js missing - run `node website/scripts/build-share-template.mjs`.");
}
const inlinedHtml = fs.readFileSync(inlined, "utf8");
const sourceHtml = fs.readFileSync(path.join(SITE_ROOT, "s", "index.html"), "utf8");
if (!inlinedHtml.includes(JSON.stringify(sourceHtml))) {
  fail("api/_share-template.js is stale - run `node website/scripts/build-share-template.mjs`.");
}

if (fs.existsSync(STATIC_SHARE_DIR)) {
  fs.rmSync(STATIC_SHARE_DIR, { recursive: true, force: true });
  console.log("prepare-deploy: pruned static/s/ so /s/* routes to api/share-preview");
} else {
  console.log("prepare-deploy: static/s/ already absent");
}

console.log("prepare-deploy: ready to deploy");
