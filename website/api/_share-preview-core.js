/**
 * Pure injector for deal-specific share-preview meta tags.
 *
 * Underscore-prefixed so Vercel treats it as a helper module, not an endpoint.
 * No I/O, no network, no globals: everything here is string in -> string out so
 * scripts/check-share-preview.mjs can exercise it directly.
 *
 * Context: /s/<CODE> is served today as a static page whose OG tags are generic
 * ("Twofer shared offer"), so every iMessage/WhatsApp unfurl of a shared deal
 * looks identical. api/share-preview.js looks the code up and hands the result
 * here; this module rewrites five tags in s/index.html and nothing else. The
 * inline client script in that template still does its own lookup and render,
 * so human visitors keep exactly today's behaviour.
 *
 * Trust model: deal_title and business_name are merchant/AI-authored strings
 * that reach us over the network. They are HTML-escaped (& < > " ') before they
 * are ever placed in an attribute value or in <title>. If anything at all looks
 * off -- missing tag, duplicated tag, empty field, non-valid share -- we return
 * null and the caller serves the untouched template.
 */

// Mirrors lib/deal-share-link.ts, the inline script in s/index.html and the
// deal-share-lookup edge function: 7 chars, no 0/O/I/L/1.
const SHARE_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$/;

const SITE_ORIGIN = "https://www.twoferapp.com";

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Merchant/AI copy can carry newlines and runs of whitespace. Attribute values
// and <title> render those as noise, so flatten before escaping.
function normalizeField(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Replace the value of content="..." on the single <meta> tag carrying
// attrName="attrValue". Attribute order inside the tag does not matter.
// Returns null unless exactly one such tag exists (0 = template drifted,
// 2+ = ambiguous, and both mean "do not touch this page").
function replaceMetaContent(html, attrName, attrValue, nextValue) {
  const identifier = new RegExp(
    `\\s${escapeRegExp(attrName)}\\s*=\\s*"${escapeRegExp(attrValue)}"`,
    "i",
  );
  const contentAttr = /(\scontent\s*=\s*")[^"]*(")/i;
  const metaTag = /<meta\b[^>]*>/gi;

  const hits = [];
  let match;
  while ((match = metaTag.exec(html)) !== null) {
    const tag = match[0];
    if (!identifier.test(tag) || !contentAttr.test(tag)) continue;
    hits.push({ start: match.index, end: match.index + tag.length, tag });
  }
  if (hits.length !== 1) return null;

  const hit = hits[0];
  // Function replacer: nextValue is untrusted text and may contain $& / $` /
  // $' / $$, which a string replacement would expand.
  const nextTag = hit.tag.replace(contentAttr, (_whole, open, close) => open + nextValue + close);
  return html.slice(0, hit.start) + nextTag + html.slice(hit.end);
}

// Replace only the text inside <title ...>...</title>; the data-i18n attribute
// (and everything else on the tag) is preserved deliberately, so the runtime
// localization pass behaves exactly as it does today for human visitors.
function replaceTitleText(html, nextText) {
  const titleTag = /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/gi;
  const hits = [];
  let match;
  while ((match = titleTag.exec(html)) !== null) {
    hits.push({ start: match.index, end: match.index + match[0].length, open: match[1], close: match[3] });
  }
  if (hits.length !== 1) return null;
  const hit = hits[0];
  return html.slice(0, hit.start) + hit.open + nextText + hit.close + html.slice(hit.end);
}

/**
 * @param {string} templateHtml raw s/index.html
 * @param {object} share deal-share-lookup `share` object
 * @param {string} code share code from the URL
 * @returns {string|null} rewritten HTML, or null when the caller should serve
 *   templateHtml unchanged.
 */
function injectShareMeta(templateHtml, share, code) {
  if (typeof templateHtml !== "string" || !templateHtml) return null;
  if (!share || typeof share !== "object") return null;
  // Defence in depth: the caller already gates on this, but the core refuses to
  // advertise anything that is not an explicitly valid share.
  if (share.share_status !== "valid") return null;

  const normalizedCode = String(code === null || code === undefined ? "" : code)
    .trim()
    .toUpperCase();
  if (!SHARE_CODE_RE.test(normalizedCode)) return null;

  const dealTitle = normalizeField(share.deal_title);
  const businessName = normalizeField(share.business_name);
  if (!dealTitle || !businessName) return null;

  const safeTitle = escapeHtml(dealTitle);
  const safeBusiness = escapeHtml(businessName);
  const safeCode = escapeHtml(normalizedCode);

  // Static punctuation stays literal; only the untrusted halves are escaped.
  const pageTitle = `${safeTitle} at ${safeBusiness} | Twofer`;
  const description = `${safeTitle} at ${safeBusiness}. Open it in Twofer and claim it before it's gone.`;
  const ogTitle = `${safeTitle} — ${safeBusiness}`;
  const ogUrl = `${SITE_ORIGIN}/s/${safeCode}`;

  // og:image / twitter:card are intentionally left on the brand card: the
  // lookup exposes no deal image, and business_logo_url is square and often
  // missing.
  let html = replaceTitleText(templateHtml, pageTitle);
  if (html === null) return null;
  html = replaceMetaContent(html, "name", "description", description);
  if (html === null) return null;
  html = replaceMetaContent(html, "property", "og:title", ogTitle);
  if (html === null) return null;
  html = replaceMetaContent(html, "property", "og:description", description);
  if (html === null) return null;
  html = replaceMetaContent(html, "property", "og:url", ogUrl);
  if (html === null) return null;

  return html;
}

module.exports = {
  SHARE_CODE_RE,
  SITE_ORIGIN,
  escapeHtml,
  injectShareMeta,
  normalizeField,
};
