// [aiqa] poster-quality — top/mid/bottom band busyness probe.
//
// Promoted + generalized from artifacts/poster-quality/2026-07-20-run2/harness/tier2-craft-regen.mjs
// (the network-generation + hardcoded-cell parts of that harness are dropped; only the
// measurement it performed is kept). Origin defect: across the run-2 corpus the poster's
// TOP band — the one the headline prints over — came back BUSIER (higher per-row luminance
// standard deviation) than the MIDDLE band in 5 of 6 cells. A good background image inverts
// that, since a calm top band is what lets the headline read without fighting the photo.
//
// Metric: per-band mean horizontal contrast = the standard deviation of per-row mean
// luminance, sampled across evenly spaced rows within each band (top/mid/bottom, 4:5
// canvas fractions by default). A busy band has photo texture directly behind the text;
// a calm band does not.
//
// Usage:
//   node scripts/qa/poster-band-busyness.mjs <image.png> [image2.png ...]
//   node scripts/qa/poster-band-busyness.mjs --dir artifacts/poster-quality/2026-07-20-run2/corpus
//   node scripts/qa/poster-band-busyness.mjs --before before.png --after after.png
//   node scripts/qa/poster-band-busyness.mjs <image.png> --bands 0,0.245,0.658,1
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";

// Flags that consume the following token as a value (rather than it being positional).
const VALUE_FLAGS = new Set(["dir", "before", "after", "bands"]);
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

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const BAND_FRACTIONS = String(args.bands || "0,0.245,0.658,1")
  .split(",")
  .map(Number);
if (BAND_FRACTIONS.length !== 4 || BAND_FRACTIONS.some((n) => !Number.isFinite(n))) {
  console.error("--bands must be 4 comma-separated fractions, e.g. 0,0.245,0.658,1");
  process.exit(1);
}
const [F_TOP0, F_TOP1, F_MID1, F_BOTTOM1] = BAND_FRACTIONS;

/** Per-band mean luminance and mean horizontal contrast (row sd), on 4:5 poster bands. */
function bandStats(file) {
  if (!fs.existsSync(file)) return null;
  const p = PNG.sync.read(fs.readFileSync(file));
  const row = (y) => {
    const vals = [];
    for (let x = 0; x < p.width; x += 4) {
      const i = (p.width * y + x) << 2;
      vals.push(0.2126 * lin(p.data[i]) + 0.7152 * lin(p.data[i + 1]) + 0.0722 * lin(p.data[i + 2]));
    }
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length;
    return [m, Math.sqrt(v)];
  };
  const band = (y0, y1) => {
    let ms = 0, ss = 0, n = 0;
    for (let f = y0; f < y1; f += 0.02) {
      const [m, s] = row(Math.floor(f * p.height));
      ms += m; ss += s; n += 1;
    }
    return { luma: ms / n, sd: ss / n };
  };
  return {
    file,
    size: `${p.width}x${p.height}`,
    top: band(F_TOP0, F_TOP1),
    mid: band(F_TOP1, F_MID1),
    bottom: band(F_MID1, F_BOTTOM1),
  };
}

function listPngs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listPngs(full));
    else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function topBusier(s) {
  return s.top.sd > s.mid.sd;
}

if (args.before || args.after) {
  if (!args.before || !args.after) {
    console.error("usage: --before <image.png> --after <image.png>");
    process.exit(1);
  }
  const before = bandStats(String(args.before));
  const after = bandStats(String(args.after));
  if (!before || !after) {
    console.error("could not read one or both images");
    process.exit(1);
  }
  console.log("\n=== TOP-BAND BUSY-NESS (the headline's background) ===");
  console.log("top-sd before -> after     mid-sd before -> after    top busier than mid?");
  console.log(
    `${before.top.sd.toFixed(3)} -> ${after.top.sd.toFixed(3)}` +
      `          ${before.mid.sd.toFixed(3)} -> ${after.mid.sd.toFixed(3)}` +
      `        ${topBusier(before) ? "TOP BUSIER" : "ok"} -> ${topBusier(after) ? "TOP BUSIER" : "ok"}`,
  );
  process.exit(0);
}

let files = [];
if (args.dir) {
  files = listPngs(String(args.dir));
} else {
  files = positional;
}
if (files.length === 0) {
  console.log(
    "usage: node scripts/qa/poster-band-busyness.mjs <image.png> [image2.png ...]\n" +
      "   or: node scripts/qa/poster-band-busyness.mjs --dir <corpus-dir>\n" +
      "   or: node scripts/qa/poster-band-busyness.mjs --before <a.png> --after <b.png>",
  );
  process.exit(1);
}

console.log(`\n${"file".padEnd(60)} top-luma top-sd  mid-luma mid-sd  bot-luma bot-sd  verdict`);
let busyCount = 0;
for (const file of files) {
  const s = bandStats(file);
  if (!s) {
    console.log(`${file.padEnd(60)} (unreadable)`);
    continue;
  }
  const busy = topBusier(s);
  if (busy) busyCount += 1;
  console.log(
    `${file.padEnd(60)} ${s.top.luma.toFixed(3)}    ${s.top.sd.toFixed(3)}  ${s.mid.luma.toFixed(3)}    ${s.mid.sd.toFixed(3)}  ` +
      `${s.bottom.luma.toFixed(3)}    ${s.bottom.sd.toFixed(3)}  ${busy ? "TOP BUSIER" : "ok"}`,
  );
}
console.log(`\n--> ${busyCount}/${files.length} image(s) have a top band busier than the middle band.`);
