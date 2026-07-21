// [aiqa] poster-quality run 2026-07-20 — mechanical legibility check.
//
// Two modes:
//   (a) --bg <image.png>   : sample the RAW generated background at each V1 text
//        block, composite the known `fresh`-template overlays (teal wash + black
//        scrim) the renderer applies, then compute WCAG contrast vs each block's
//        text color. Runs with zero device — a preliminary read to be confirmed on
//        a real device screenshot.
//   (b) --shot <screen.png> --crop x,y,w,h : sample a REAL rendered poster crop
//        (scrim already baked in) at each block. Most faithful.
//
// Large display text (headline/offer) below 3:1 effective contrast = mechanical
// HARD FAIL (§7). 3:1–4.5:1 = WARN. This makes the legibility call math, not taste.
//
// Usage:
//   node scripts/qa/poster-contrast-check.mjs --bg artifacts/ai-hardening/2026-07-20/tier1/i01/poster.png --template fresh
//   node scripts/qa/poster-contrast-check.mjs --shot shot.png --crop 100,340,940,1175 --template fresh
import { PNG } from "pngjs";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
    return acc;
  }, []),
);

const CANVAS_H = 1350; // canvas is 1080x1350 (4:5); only height is needed (blocks span full width)

// V1 text blocks (canvas coords) — from components/poster/AdPosterCanvas.tsx.
// y/h chosen to cover each text line's band; color = the theme color that block uses.
const V1_BLOCKS = [
  { key: "business", y: 28, h: 50, size: 34, big: false, colorKey: "business" },
  { key: "kicker", y: 86, h: 54, size: 42, big: true, colorKey: "accent" },
  { key: "headline", y: 148, h: 170, size: 72, big: true, colorKey: "headline" },
  { key: "offer_primary", y: 1036, h: 80, size: 58, big: true, colorKey: "accent" },
  { key: "offer_secondary", y: 1120, h: 120, size: 58, big: true, colorKey: "headline" },
  { key: "schedule", y: 1290, h: 40, size: 28, big: false, colorKey: "subline" },
];

// fresh template colors (components/poster/posterTemplates.ts)
const THEME = {
  fresh: { headline: "#063D3A", business: "#0F3A37", subline: "#37635F", accent: "#F6C445" },
  bold: { headline: "#FFFFFF", business: "#FFFFFF", subline: "#FDE68A", accent: "#22C55E" },
  premium: { headline: "#FFF4DC", business: "#FFF9ED", subline: "#E7BE79", accent: "#D89A40" },
};

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const over = (fg, fa, bg) => fg * fa + bg * (1 - fa); // sRGB alpha composite, fg over bg
const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// Black 7-stop full-canvas scrim from V1 PosterContent, evenly spaced 0..1.
const SCRIM_STOPS = [0.92, 0.66, 0.18, 0.0, 0.12, 0.82, 0.98];
function scrimAlphaAt(yFrac) {
  const seg = yFrac * (SCRIM_STOPS.length - 1);
  const i = Math.min(SCRIM_STOPS.length - 2, Math.floor(seg));
  const t = seg - i;
  return SCRIM_STOPS[i] * (1 - t) + SCRIM_STOPS[i + 1] * t;
}
// fresh teal wash (PosterBackground) 3-stop 0.42 -> 0.08 -> 0.18
function tealWashAt(yFrac) {
  const stops = [0.42, 0.08, 0.18];
  const seg = yFrac * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const t = seg - i;
  return stops[i] * (1 - t) + stops[i + 1] * t;
}
const TEAL = [4, 84, 86];
// OfferBlock adds an extra black gradient over the bottom band (top 888 -> 1350): 0 -> 0.70 -> 0.98
function offerScrimAlphaAt(y) {
  if (y < 888) return 0;
  const f = (y - 888) / (CANVAS_H - 888);
  const stops = [0.0, 0.7, 0.98], locs = [0, 0.26, 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (f <= locs[i + 1]) {
      const t = (f - locs[i]) / (locs[i + 1] - locs[i]);
      return stops[i] * (1 - t) + stops[i + 1] * t;
    }
  }
  return 0.98;
}

function meanRegion(png, x0, y0, w, h) {
  const { width, height, data } = png;
  let r = 0, g = 0, b = 0, n = 0;
  const xe = Math.min(width, x0 + w), ye = Math.min(height, y0 + h);
  for (let y = Math.max(0, y0); y < ye; y += 2) {
    for (let x = Math.max(0, x0); x < xe; x += 2) {
      const idx = (width * y + x) << 2;
      r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

const template = String(args.template || "fresh");
const theme = THEME[template] || THEME.fresh;

function verdict(cr, big) {
  const floor = big ? 3.0 : 4.5;
  if (cr < floor) return "FAIL";
  if (cr < 4.5) return "WARN";
  return "PASS";
}

if (args.bg) {
  const png = PNG.sync.read(fs.readFileSync(args.bg));
  const sy = png.height / CANVAS_H;
  console.log(`\n=== ${args.bg}  (${png.width}x${png.height}, template=${template}, RAW bg + modeled scrim) ===`);
  let fails = 0;
  for (const blk of V1_BLOCKS) {
    // Sample the full image width across the block's vertical band (text is centered, wide).
    const base = meanRegion(png, 0, Math.round(blk.y * sy), png.width, Math.round(blk.h * sy));
    // composite fresh overlays over the sampled image mean, at this block's vertical center
    const yc = (blk.y + blk.h / 2) / CANVAS_H;
    let eff = base.slice();
    // teal wash
    const ta = tealWashAt(yc);
    eff = eff.map((c, i) => over(TEAL[i], ta, c));
    // black full-canvas scrim
    const sa = scrimAlphaAt(yc);
    eff = eff.map((c) => over(0, sa, c));
    // offer bottom scrim
    const oa = offerScrimAlphaAt(blk.y + blk.h / 2);
    eff = eff.map((c) => over(0, oa, c));
    const txt = hexToRgb(theme[blk.colorKey]);
    const cr = contrast(txt, eff);
    const v = verdict(cr, blk.big);
    if (v === "FAIL") fails++;
    console.log(
      `  ${blk.key.padEnd(16)} text=${theme[blk.colorKey]} effBg=rgb(${eff.map((c) => Math.round(c)).join(",")}) ` +
        `scrim=${(sa + oa).toFixed(2)}  contrast=${cr.toFixed(2)}:1  ${v}`,
    );
  }
  console.log(`  --> ${fails} hard-fail block(s)`);
} else if (args.shot) {
  const png = PNG.sync.read(fs.readFileSync(args.shot));
  const [cx, cy, cw, ch] = String(args.crop).split(",").map(Number);
  const sy = ch / CANVAS_H;
  console.log(`\n=== ${args.shot} crop=${args.crop} (rendered, scrim baked in) ===`);
  let fails = 0;
  for (const blk of V1_BLOCKS) {
    const eff = meanRegion(png, cx, Math.round(cy + blk.y * sy), cw, Math.round(blk.h * sy));
    const txt = hexToRgb(theme[blk.colorKey]);
    const cr = contrast(txt, eff);
    const v = verdict(cr, blk.big);
    if (v === "FAIL") fails++;
    console.log(`  ${blk.key.padEnd(16)} text=${theme[blk.colorKey]} bg=rgb(${eff.map((c) => Math.round(c)).join(",")}) contrast=${cr.toFixed(2)}:1  ${v}`);
  }
  console.log(`  --> ${fails} hard-fail block(s)`);
} else {
  console.log("usage: --bg <image.png> [--template fresh|bold|premium]  OR  --shot <screenshot.png> --crop x,y,w,h");
  process.exit(1);
}
