// Generates api/_share-template.js from the canonical s/index.html.
//
// Why inline the template into JS instead of reading the file at runtime:
// every path under /s/ is claimed by Vercel's static resolution before our
// route table runs, so the share preview function has to be able to serve the
// page WITHOUT a static s/index.html existing in the deployment. Inlining also
// removes the runtime dependency on functions.includeFiles, which cannot be
// verified locally.
//
// Run: node website/scripts/build-share-template.mjs
// Verified by: node website/scripts/check-share-preview.mjs (drift gate)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(SITE_ROOT, "s", "index.html");
const TARGET = path.join(SITE_ROOT, "api", "_share-template.js");

const html = fs.readFileSync(SOURCE, "utf8");

const banner = `// GENERATED FILE - do not edit by hand.
// Source: website/s/index.html
// Regenerate: node website/scripts/build-share-template.mjs
// The drift gate in scripts/check-share-preview.mjs fails if this is stale.
`;

fs.writeFileSync(
  TARGET,
  `${banner}module.exports = ${JSON.stringify(html)};\n`,
  "utf8",
);

console.log(`share template inlined: ${html.length} chars -> api/_share-template.js`);
