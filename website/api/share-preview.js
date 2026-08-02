/**
 * Server-rendered OG/meta for shared deal links (/s/<CODE>).
 *
 * vercel.json rewrites /s/<7-char code> here; every other /s path still goes
 * straight to the static template. This handler serves the SAME s/index.html
 * bytes as before, with five head tags rewritten when the code resolves to a
 * live share, so an iMessage/WhatsApp/Slack unfurl shows the actual deal
 * instead of the generic "Twofer shared offer" card. The template's inline
 * script does its own lookup and rendering, untouched, so human visitors get
 * exactly today's page.
 *
 * Failure policy: this endpoint never shows a visitor an error. Bad code,
 * upstream 429/5xx, timeout, malformed JSON, template drift -> serve the
 * template unchanged. Template unreadable (should be impossible once
 * includeFiles ships it) -> 302 to /s.
 *
 * Rate limiting: deal-share-lookup allows 120 lookups per IP per 900s, and all
 * bot unfurls funnel through Vercel egress IPs. The CDN cache headers below are
 * what keep crawler storms off that budget.
 */

const fs = require("node:fs");
const path = require("node:path");

const { SHARE_CODE_RE, injectShareMeta } = require("./_share-preview-core");

const LOOKUP_ENDPOINT =
  "https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/deal-share-lookup";
const LOOKUP_TIMEOUT_MS = 2500;
const CACHE_CONTROL = "public, max-age=0, s-maxage=120, stale-while-revalidate=600";

let cachedTemplate = null;

// vercel.json ships the template into this function's bundle via
// functions["api/share-preview.js"].includeFiles, which places it at its
// project-relative path -- i.e. process.cwd()/s/index.html, the documented
// includeFiles access pattern. The __dirname sibling resolves to the same file
// in a correct bundle and only matters if the runtime cwd is ever not the
// project root; if neither exists the caller redirects to /s.
function loadTemplate() {
  if (cachedTemplate !== null) return cachedTemplate;
  const candidates = [
    path.join(process.cwd(), "s", "index.html"),
    path.join(__dirname, "..", "s", "index.html"),
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      cachedTemplate = fs.readFileSync(candidate, "utf8");
      return cachedTemplate;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function sendHtml(req, res, html) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.setHeader("Content-Length", String(Buffer.byteLength(html, "utf8")));
  if (req.method === "HEAD") return res.end();
  return res.end(html);
}

async function lookupShare(code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(LOOKUP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    if (!response.ok) return null; // includes 429 and 5xx
    const payload = await response.json();
    return payload && typeof payload === "object" && payload.share ? payload.share : null;
  } catch {
    // abort / DNS / TLS / malformed JSON
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Which vercel.json rewrite wins for /s/<CODE> is empirically unstable
// (the declared /s/:code rule loses to the later /s/:path* catch-all in
// production, while elsewhere earlier rules win), so BOTH /s rules point
// here and the code is recovered from whichever channel the winning rule
// used: the ?code= query, or the `code` / `path` params that Vercel
// surfaces in the urlencoded x-now-route-matches header. `sourceUsed` is
// reported in an x-share-preview-match debug header.
function codeFromRequest(req) {
  if (req.query && typeof req.query.code === "string" && req.query.code) {
    return { code: req.query.code, sourceUsed: "query" };
  }
  const matches = req.headers && req.headers["x-now-route-matches"];
  if (typeof matches === "string" && matches) {
    try {
      const parsed = new URLSearchParams(matches);
      const fromCode = parsed.get("code");
      if (fromCode) return { code: fromCode, sourceUsed: "route-code" };
      const fromPath = parsed.get("path");
      if (fromPath) return { code: fromPath, sourceUsed: "route-path" };
    } catch {
      // fall through
    }
  }
  return { code: "", sourceUsed: "none" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Method not allowed.");
  }

  let template;
  try {
    template = loadTemplate();
  } catch {
    res.statusCode = 302;
    res.setHeader("Location", "/s");
    res.setHeader("Cache-Control", "no-store");
    return res.end();
  }

  const extracted = codeFromRequest(req);
  const code = String(extracted.code).trim().toUpperCase();
  res.setHeader("x-share-preview-match", extracted.sourceUsed);
  if (!SHARE_CODE_RE.test(code)) return sendHtml(req, res, template);

  const share = await lookupShare(code);
  if (!share || share.share_status !== "valid") return sendHtml(req, res, template);

  const injected = injectShareMeta(template, share, code);
  return sendHtml(req, res, injected || template);
};
