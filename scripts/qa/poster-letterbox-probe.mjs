// [aiqa] poster-quality — letterbox (baked black bars) probe.
//
// Promoted + generalized from artifacts/poster-quality/2026-07-20-run2/harness/tier3-image-probe.mjs
// (the Supabase deal-lookup + storage-download parts of that harness are dropped; this
// version takes a local image file directly). Origin question: is a delivered poster
// image full-bleed, or letterboxed? A screenshot alone cannot settle it — the app's
// adaptive scrim also darkens the top band, and over a dark subject a scrim can read as
// a bar even when the underlying image is fine.
//
// The discriminator is WITHIN-ROW VARIANCE, not brightness. A baked letterbox bar is
// flat, uniform color: sd ~= 0. A scrim over real photography still has the photo's
// texture showing through underneath: sd > 0. So this probe prints a row profile and
// looks for a run of near-zero-sd rows at the top/bottom edges.
//
// Usage:
//   node scripts/qa/poster-letterbox-probe.mjs <image.png>
//   node scripts/qa/poster-letterbox-probe.mjs <image.png> --threshold 0.0005 --step 0.025
import { PNG } from "pngjs";
import fs from "node:fs";

const VALUE_FLAGS = new Set(["threshold", "step"]);
const rawArgs = process.argv.slice(2);
const args = {};
const positional = [];
for (let i = 0; i < rawArgs.length; i += 1) {
  const a = rawArgs[i];
  if (a.startsWith("--")) {
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name) && rawArgs[i + 1] !== undefined) {
      args[name] = rawArgs[i + 1];
      i += 1;
    } else {
      args[name] = true;
    }
  } else {
    positional.push(a);
  }
}

const file = positional[0];
if (!file) {
  console.error("usage: node scripts/qa/poster-letterbox-probe.mjs <image.png> [--threshold 0.0005] [--step 0.025]");
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`no such file: ${file}`);
  process.exit(1);
}

const threshold = Number(args.threshold ?? 0.0005);
const step = Number(args.step ?? 0.025);

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const p = PNG.sync.read(fs.readFileSync(file));
const ratio = (p.width / p.height).toFixed(3);
console.log(`\nfile   : ${file}`);
console.log(`size   : ${p.width}x${p.height}  ratio ${ratio}  (4:5 = 0.800)`);

function rowStats(y) {
  const vals = [];
  for (let x = 0; x < p.width; x += 4) {
    const i = (p.width * y + x) << 2;
    vals.push(0.2126 * lin(p.data[i]) + 0.7152 * lin(p.data[i + 1]) + 0.0722 * lin(p.data[i + 2]));
  }
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length;
  return [m, Math.sqrt(v)];
}

console.log("\n   y/H     luma      sd     verdict");
let flatRows = 0;
let sampled = 0;
const flatRowFractions = [];
for (let f = 0; f <= 1.0001; f += step) {
  const y = Math.min(p.height - 1, Math.floor(f * p.height));
  const [m, s] = rowStats(y);
  const flat = s < threshold;
  sampled += 1;
  if (flat) {
    flatRows += 1;
    flatRowFractions.push(Number(f.toFixed(3)));
  }
  console.log(`  ${f.toFixed(3)}   ${m.toFixed(4)}  ${s.toFixed(4)}   ${flat ? "FLAT (no photo texture)" : ""}`);
}

const verdict = flatRows > 0 ? "LETTERBOXED" : "FULL_BLEED";
console.log(
  `\nflat rows: ${flatRows}/${sampled} sampled (threshold sd<${threshold}).` +
    (flatRows > 0
      ? "  -> baked bars present: the image itself carries dead pixels."
      : "  -> full bleed: every sampled row carries photo texture."),
);
console.log(`verdict: ${verdict}`);
if (flatRowFractions.length) console.log(`flat at y/H: ${flatRowFractions.join(", ")}`);
console.log("\nDONE (read-only, local file, 0 generations).");

if (process.env.TWOFER_LETTERBOX_EXIT_NONZERO === "1" && verdict === "LETTERBOXED") process.exit(1);
