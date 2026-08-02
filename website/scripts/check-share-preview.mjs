#!/usr/bin/env node
/**
 * Self-test for the /s/<CODE> share-preview meta injector.
 *
 * Runs against the REAL website/s/index.html, so it doubles as a drift gate:
 * if someone edits the title/description/og tags in that template, the exact
 * markers this injector matches on stop matching and the cases below fail here
 * instead of silently degrading every link unfurl in production.
 *
 * No dependencies outside Node builtins, no framework. Paths resolve relative
 * to this file, so `node website/scripts/check-share-preview.mjs` and
 * `node scripts/check-share-preview.mjs` behave identically.
 *
 * The module under test is CommonJS (it ships as a Vercel function helper), so
 * it is loaded through module.createRequire rather than import.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { escapeHtml, injectShareMeta } = require(path.join(SITE_ROOT, "api", "_share-preview-core.js"));

const TEMPLATE = fs.readFileSync(path.join(SITE_ROOT, "s", "index.html"), "utf8");
const CODE = "ABCD234";

let failures = 0;
let currentCase = "";
const problems = [];

function check(label, condition, detail) {
  if (condition) return;
  failures += 1;
  problems.push(`  [${currentCase}] ${label}${detail ? ` -- ${detail}` : ""}`);
}

function runCase(name, fn) {
  currentCase = name;
  const before = failures;
  try {
    fn();
  } catch (err) {
    failures += 1;
    problems.push(`  [${name}] threw: ${err && err.stack ? err.stack : String(err)}`);
  }
  const ok = failures === before;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

function count(haystack, needle) {
  if (!needle) return 0;
  let total = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    total += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return total;
}

function head(html) {
  const start = html.indexOf("<head>");
  const end = html.indexOf("</head>");
  return start >= 0 && end > start ? html.slice(start, end) : "";
}

function changedLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) return null;
  const changed = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) changed.push({ line: i + 1, before: a[i], after: b[i] });
  return changed;
}

const validShare = {
  share_status: "valid",
  deal_id: "00000000-0000-4000-8000-000000000000",
  deal_title: "Free Latte",
  deal_end_time: "2026-08-02T02:00:00.000Z",
  business_name: "Test Cafe & Co",
  business_address: "100 Main St, Irving TX",
  business_logo_url: "https://example.test/logo.png",
};

console.log("share-preview injector self-test\n");

// ---------------------------------------------------------------- escaping --
runCase("escapeHtml escapes & < > \" ' and nothing else", () => {
  check("ampersand first", escapeHtml("&<>\"'") === "&amp;&lt;&gt;&quot;&#39;", escapeHtml("&<>\"'"));
  check("double-escaping is not attempted", escapeHtml("&amp;") === "&amp;amp;", escapeHtml("&amp;"));
  check("plain text untouched", escapeHtml("Buy one get one, 50% off") === "Buy one get one, 50% off");
  check("null/undefined become empty", escapeHtml(null) === "" && escapeHtml(undefined) === "");
  check("non-strings are stringified", escapeHtml(42) === "42");
});

runCase("hostile deal_title/business_name cannot break out of the markup", () => {
  const payload = '</script><script>alert(1)</script> "quoted" & <b>bold</b>';
  const html = injectShareMeta(TEMPLATE, { ...validShare, deal_title: payload, business_name: "Bob's & \"Sons\" <Grill>" }, CODE);
  check("injection happened", typeof html === "string" && html.length > 0);
  if (typeof html !== "string") return;

  const injectedHead = head(html);
  check("no raw payload anywhere in the document", !html.includes("<script>alert(1)</script>"), "raw script payload survived");
  check("no new <script in <head>", !/<script/i.test(injectedHead), "script tag reached the head");
  check("no raw < from the payload in <head>", !injectedHead.includes("<b>bold</b>"));
  check("no raw double quote breakout", !injectedHead.includes('"quoted"'));
  check("no raw apostrophe from business_name", !injectedHead.includes("Bob's"));
  check("payload is present in escaped form", injectedHead.includes("&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  check("quotes escaped", injectedHead.includes("&quot;quoted&quot;"));
  check("apostrophe escaped", injectedHead.includes("Bob&#39;s"));
  check("ampersand escaped", injectedHead.includes("&amp; &lt;b&gt;bold&lt;/b&gt;"));

  // Structural proof: a breakout would add tags. Tag counts must be identical.
  const tagCount = (value) => (value.match(/</g) || []).length;
  check(
    "head tag-open count unchanged",
    tagCount(injectedHead) === tagCount(head(TEMPLATE)),
    `${tagCount(head(TEMPLATE))} -> ${tagCount(injectedHead)}`,
  );
});

// --------------------------------------------------------------- injection --
runCase("valid share swaps all five targets exactly once", () => {
  const html = injectShareMeta(TEMPLATE, validShare, CODE);
  check("returned a string", typeof html === "string");
  if (typeof html !== "string") return;

  const expected = [
    ['<title data-i18n="share.title">Free Latte at Test Cafe &amp; Co | Twofer</title>', "title"],
    [
      '<meta name="description" content="Free Latte at Test Cafe &amp; Co. Open it in Twofer and claim it before it\'s gone." />',
      "description",
    ],
    ['<meta property="og:title" content="Free Latte — Test Cafe &amp; Co" />', "og:title"],
    [
      '<meta property="og:description" content="Free Latte at Test Cafe &amp; Co. Open it in Twofer and claim it before it\'s gone." />',
      "og:description",
    ],
    ['<meta property="og:url" content="https://www.twoferapp.com/s/ABCD234" />', "og:url"],
  ];
  for (const [needle, label] of expected) {
    check(`${label} rewritten exactly once`, count(html, needle) === 1, `found ${count(html, needle)}x`);
  }

  const changed = changedLines(TEMPLATE, html);
  check("line count unchanged", changed !== null);
  check("exactly five lines changed", changed && changed.length === 5, changed ? `${changed.length} changed` : "n/a");

  check("og:image untouched", html.includes('<meta property="og:image" content="https://www.twoferapp.com/assets/og-card.jpg" />'));
  check("twitter:card untouched", html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  check("robots noindex untouched", html.includes('<meta name="robots" content="noindex, nofollow" />'));
  check("apple-itunes-app untouched", html.includes('<meta name="apple-itunes-app" content="app-id=6765769303" />'));
  check("title keeps its data-i18n attribute", html.includes('<title data-i18n="share.title">'));

  const bodyStart = TEMPLATE.indexOf("<body");
  check(
    "everything from <body> onward is byte-identical (inline script untouched)",
    html.slice(html.indexOf("<body")) === TEMPLATE.slice(bodyStart),
  );
});

runCase("share code is normalized into og:url", () => {
  const lower = injectShareMeta(TEMPLATE, validShare, " abcd234 ");
  check("lowercase + padded code accepted", typeof lower === "string");
  check(
    "og:url uses the uppercase code",
    typeof lower === "string" && lower.includes('content="https://www.twoferapp.com/s/ABCD234"'),
  );
  check("malformed code rejected", injectShareMeta(TEMPLATE, validShare, "AB") === null);
  check("code with excluded alphabet rejected", injectShareMeta(TEMPLATE, validShare, "ABCD23O") === null);
  check("missing code rejected", injectShareMeta(TEMPLATE, validShare, undefined) === null);
});

// ---------------------------------------------------------------- fallback --
runCase("missing tag marker returns null", () => {
  const noOgUrl = TEMPLATE.replace('<meta property="og:url" content="https://www.twoferapp.com/s" />', "");
  check("og:url removed -> null", injectShareMeta(noOgUrl, validShare, CODE) === null);

  const noTitle = TEMPLATE.replace(/<title[^>]*>[\s\S]*?<\/title>/, "");
  check("title removed -> null", injectShareMeta(noTitle, validShare, CODE) === null);

  const noDescription = TEMPLATE.replace(/<meta name="description"[^>]*>/, "");
  check("description removed -> null", injectShareMeta(noDescription, validShare, CODE) === null);

  const duplicatedOgTitle = TEMPLATE.replace(
    '<meta property="og:title" content="Twofer shared offer" />',
    '<meta property="og:title" content="Twofer shared offer" />\n    <meta property="og:title" content="dupe" />',
  );
  check("duplicated og:title -> null (ambiguous)", injectShareMeta(duplicatedOgTitle, validShare, CODE) === null);

  check("empty template -> null", injectShareMeta("", validShare, CODE) === null);
  check("non-string template -> null", injectShareMeta(null, validShare, CODE) === null);
});

runCase("non-valid share_status is never rendered", () => {
  for (const status of ["expired", "not_found", "invalid", "", "VALID", "valid ", null, undefined]) {
    const share = { ...validShare, share_status: status };
    check(`share_status=${JSON.stringify(status)} -> null`, injectShareMeta(TEMPLATE, share, CODE) === null);
  }
  check("missing share object -> null", injectShareMeta(TEMPLATE, null, CODE) === null);
  check("non-object share -> null", injectShareMeta(TEMPLATE, "valid", CODE) === null);
  check("share_status alone is not enough", injectShareMeta(TEMPLATE, { share_status: "valid" }, CODE) === null);
});

runCase("empty or missing deal_title / business_name returns null", () => {
  check("empty deal_title", injectShareMeta(TEMPLATE, { ...validShare, deal_title: "" }, CODE) === null);
  check("whitespace deal_title", injectShareMeta(TEMPLATE, { ...validShare, deal_title: "   \n\t " }, CODE) === null);
  check("null deal_title", injectShareMeta(TEMPLATE, { ...validShare, deal_title: null }, CODE) === null);
  check("missing deal_title", injectShareMeta(TEMPLATE, { ...validShare, deal_title: undefined }, CODE) === null);
  check("empty business_name", injectShareMeta(TEMPLATE, { ...validShare, business_name: "" }, CODE) === null);
  check("null business_name", injectShareMeta(TEMPLATE, { ...validShare, business_name: null }, CODE) === null);
  check("non-string deal_title", injectShareMeta(TEMPLATE, { ...validShare, deal_title: 12 }, CODE) === null);
});

runCase("multi-line merchant copy is flattened, $ patterns survive verbatim", () => {
  const html = injectShareMeta(
    TEMPLATE,
    { ...validShare, deal_title: "Two\nfor\tone   tacos $$ $& $` $'", business_name: " Taco  Stand " },
    CODE,
  );
  check("injection happened", typeof html === "string");
  if (typeof html !== "string") return;
  check(
    "whitespace collapsed and $-patterns preserved",
    html.includes("<title data-i18n=\"share.title\">Two for one tacos $$ $&amp; $` $&#39; at Taco Stand | Twofer</title>"),
    html.slice(html.indexOf("<title"), html.indexOf("</title>") + 8),
  );
  check("no newline leaked into an attribute value", !/content="[^"]*\n/.test(html));
});

console.log("");
if (failures) {
  console.error(`share-preview self-test FAILED: ${failures} assertion(s).\n`);
  for (const problem of problems) console.error(problem);
  console.error("");
  process.exit(1);
}
console.log("share-preview self-test passed: all cases green.");
