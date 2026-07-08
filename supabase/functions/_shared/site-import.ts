/**
 * Pure helpers for the website-import onboarding feature (WI-2).
 *
 * Everything here is I/O-free so it can be unit-tested with vitest (no live
 * function, no Deno runtime). The edge function (`import-business-website`)
 * is a thin orchestration shell over these helpers.
 *
 * Security note: `validateImportUrl` and `isPrivateOrReservedIp` are the
 * syntax + IP-range halves of the SSRF defense. The async DNS resolution and
 * the byte-capped streaming fetch live in the edge function's `safeFetch`.
 */

// ---------------------------------------------------------------------------
// Shared caps / constants
// ---------------------------------------------------------------------------

export const MAX_HTML_BYTES = 2_000_000;
export const MAX_IMAGE_BYTES = 512_000;
export const MAX_PDF_BYTES = 5_000_000;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
export const MAX_LOGO_CANDIDATES = 4;
export const DAILY_SCAN_LIMIT_DEFAULT = 10;
export const MAX_MENU_TEXT_CHARS = 20_000;
export const MAX_IMPORT_URL_LENGTH = 2048;

export const AI_SITE_MENU_IMPORT_PROMPT_VERSION = "AI_SITE_MENU_IMPORT_V1";

// ---------------------------------------------------------------------------
// URL validation (syntax level; DNS/IP re-check happens in the fetch wrapper)
// ---------------------------------------------------------------------------

export type UrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; code: string };

const IPV4_LITERAL_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** A hostname that is unmistakably an IP literal (v4 dotted or bracketed v6). */
function hostnameIsIpLiteral(hostname: string): boolean {
  if (!hostname) return false;
  // URL parsing keeps IPv6 literals in bracket form: [::1]
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  if (IPV4_LITERAL_RE.test(hostname)) return true;
  return false;
}

/** localhost / *.local / *.internal — never a legitimate business website. */
function hostnameIsBlockedName(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost") return true;
  if (h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true;
  if (h.endsWith(".internal")) return true;
  return false;
}

/**
 * Syntax-level validation for a website URL we intend to fetch server-side.
 * https-only, port 443 only, no credentials, no IP-literal or local hosts,
 * length capped. Returns a typed URL on success, else a stable failure code.
 */
export function validateImportUrl(raw: string): UrlValidationResult {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, code: "MALFORMED" };
  if (value.length > MAX_IMPORT_URL_LENGTH) return { ok: false, code: "TOO_LONG" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "MALFORMED" };
  }

  if (url.protocol !== "https:") return { ok: false, code: "NOT_HTTPS" };
  if (url.username || url.password) return { ok: false, code: "HAS_CREDENTIALS" };
  // Empty port = default 443 for https. Only an explicit 443 is otherwise allowed.
  if (url.port && url.port !== "443") return { ok: false, code: "BAD_PORT" };
  if (hostnameIsIpLiteral(url.hostname)) return { ok: false, code: "IP_LITERAL" };
  if (hostnameIsBlockedName(url.hostname)) return { ok: false, code: "BLOCKED_HOST" };

  return { ok: true, url };
}

// ---------------------------------------------------------------------------
// Private / reserved IP detection (checked against DNS-resolved addresses)
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const m = IPV4_LITERAL_RE.exec(ip.trim());
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map((o) => Number(o));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

function inV4Range(value: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (baseInt & mask) >>> 0;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return (
    inV4Range(value, "10.0.0.0", 8) ||
    inV4Range(value, "172.16.0.0", 12) ||
    inV4Range(value, "192.168.0.0", 16) ||
    inV4Range(value, "127.0.0.0", 8) ||
    inV4Range(value, "169.254.0.0", 16) || // link-local incl. cloud metadata
    inV4Range(value, "0.0.0.0", 8) ||
    inV4Range(value, "100.64.0.0", 10) || // CGNAT
    inV4Range(value, "192.0.0.0", 24) ||
    inV4Range(value, "198.18.0.0", 15) || // benchmarking
    inV4Range(value, "224.0.0.0", 3) // multicast + reserved (224.0.0.0–255.255.255.255)
  );
}

/**
 * Expand an IPv6 string to 16 bytes, handling `::` compression and an
 * embedded trailing IPv4 (e.g. `::ffff:192.168.0.1`). Returns null if the
 * string is not a well-formed IPv6 address.
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (!s.includes(":")) return null;

  // Split off a zone id if present (fe80::1%eth0) — irrelevant to range checks.
  const percent = s.indexOf("%");
  if (percent >= 0) s = s.slice(0, percent);

  const doubleColon = s.split("::");
  if (doubleColon.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    const tokens = part.split(":");
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === "") return null;
      // Embedded IPv4 only valid as the final token.
      if (token.includes(".")) {
        if (i !== tokens.length - 1) return null;
        const v4 = ipv4ToInt(token);
        if (v4 === null) return null;
        groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(token)) return null;
      groups.push(parseInt(token, 16));
    }
    return groups;
  };

  let head: number[];
  let tail: number[];
  if (doubleColon.length === 2) {
    const h = parseGroups(doubleColon[0]);
    const t = parseGroups(doubleColon[1]);
    if (h === null || t === null) return null;
    const missing = 8 - (h.length + t.length);
    if (missing < 0) return null;
    head = h;
    tail = [...new Array(missing).fill(0), ...t];
  } else {
    const g = parseGroups(s);
    if (g === null || g.length !== 8) return null;
    head = g;
    tail = [];
  }

  const groups = [...head, ...tail];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

function isPrivateOrReservedIpv6(ip: string): boolean {
  const bytes = ipv6ToBytes(ip);
  if (!bytes) return false;

  const allZero = bytes.every((b) => b === 0);
  if (allZero) return true; // ::

  // ::1 (loopback)
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;

  // ::ffff:0:0/96 — IPv4-mapped. Recurse into the mapped v4.
  const mappedPrefix =
    bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mappedPrefix) {
    const v4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    return isPrivateOrReservedIpv4(v4);
  }

  // fc00::/7 — unique local
  if ((bytes[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 — link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

  return false;
}

/** True for any address in a private, loopback, link-local, or reserved range. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const value = typeof ip === "string" ? ip.trim() : "";
  if (!value) return false;
  if (IPV4_LITERAL_RE.test(value)) return isPrivateOrReservedIpv4(value);
  if (value.includes(":")) return isPrivateOrReservedIpv6(value);
  return false;
}

// ---------------------------------------------------------------------------
// HTML attribute helpers
// ---------------------------------------------------------------------------

function getAttr(tag: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = re.exec(tag);
  if (!m) return "";
  return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}

function resolveUrl(href: string, baseUrl: string): string | null {
  const raw = (href ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Extension of the URL pathname, lowercased, without the dot (e.g. "png"). */
function urlExtension(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = /\.([a-z0-9]+)$/i.exec(path);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

/** RN <Image> can't render .svg or .ico; drop those, keep raster/unknown. */
function logoExtensionAllowed(url: string): boolean {
  const ext = urlExtension(url);
  if (ext === "svg" || ext === "ico") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Logo candidate extraction
// ---------------------------------------------------------------------------

export type LogoCandidateSource =
  | "og_image"
  | "apple_touch_icon"
  | "link_icon"
  | "json_ld_logo"
  | "header_img";

export type LogoCandidate = { url: string; source: LogoCandidateSource };

const JSON_LD_TYPES = /(organization|localbusiness|restaurant|foodestablishment|store)/i;

function collectJsonLdLogos(node: unknown, out: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) collectJsonLdLogos(child, out);
    return;
  }
  if (typeof node !== "object") return;
  const record = node as Record<string, unknown>;

  const graph = record["@graph"];
  if (graph) collectJsonLdLogos(graph, out);

  const typeField = record["@type"];
  const typeMatches = Array.isArray(typeField)
    ? typeField.some((t) => typeof t === "string" && JSON_LD_TYPES.test(t))
    : typeof typeField === "string" && JSON_LD_TYPES.test(typeField);

  if (typeMatches) {
    for (const key of ["logo", "image"]) {
      const v = record[key];
      if (typeof v === "string") out.push(v);
      else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") out.push(item);
          else if (item && typeof item === "object") {
            const u = (item as Record<string, unknown>).url;
            if (typeof u === "string") out.push(u);
          }
        }
      } else if (v && typeof v === "object") {
        const u = (v as Record<string, unknown>).url;
        if (typeof u === "string") out.push(u);
      }
    }
  }

  // Recurse into nested objects (e.g. publisher, mainEntity) to reach typed nodes.
  for (const key of Object.keys(record)) {
    if (key === "@graph" || key === "@type" || key === "logo" || key === "image") continue;
    const child = record[key];
    if (child && typeof child === "object") collectJsonLdLogos(child, out);
  }
}

function extractJsonLdLogoUrls(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      collectJsonLdLogos(JSON.parse(raw), out);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return out;
}

function largestSizeFromSizes(sizes: string): number {
  // "48x48 32x32" → 48. "any" or empty → 0.
  let max = 0;
  const re = /(\d+)x(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sizes)) !== null) {
    const dim = Math.max(Number(m[1]), Number(m[2]));
    if (dim > max) max = dim;
  }
  return max;
}

/**
 * Extract candidate logo image URLs from raw HTML, in priority order, resolved
 * to absolute https URLs and de-duplicated. Caps at 6 (the fetcher keeps the
 * first MAX_LOGO_CANDIDATES that succeed).
 */
export function extractLogoCandidates(html: string, baseUrl: string): LogoCandidate[] {
  const source = typeof html === "string" ? html : "";
  const ordered: LogoCandidate[] = [];

  const push = (rawUrl: string | null | undefined, kind: LogoCandidateSource) => {
    if (!rawUrl) return;
    const resolved = resolveUrl(rawUrl, baseUrl);
    if (!resolved) return;
    if (!validateImportUrl(resolved).ok) return;
    if (!logoExtensionAllowed(resolved)) return;
    ordered.push({ url: resolved, source: kind });
  };

  // 1) JSON-LD Organization/LocalBusiness logo|image
  for (const u of extractJsonLdLogoUrls(source)) push(u, "json_ld_logo");

  // 2) og:image (+ secure_url)
  const metaRe = /<meta\b[^>]*>/gi;
  let meta: RegExpExecArray | null;
  const ogImages: string[] = [];
  while ((meta = metaRe.exec(source)) !== null) {
    const tag = meta[0];
    const prop = (getAttr(tag, "property") || getAttr(tag, "name")).toLowerCase();
    if (prop === "og:image" || prop === "og:image:secure_url") {
      const content = getAttr(tag, "content");
      if (content) ogImages.push(content);
    }
  }
  for (const u of ogImages) push(u, "og_image");

  // 3) apple-touch-icon (largest sizes first)
  const linkRe = /<link\b[^>]*>/gi;
  const appleIcons: { href: string; size: number }[] = [];
  const plainIcons: string[] = [];
  let link: RegExpExecArray | null;
  while ((link = linkRe.exec(source)) !== null) {
    const tag = link[0];
    const rel = getAttr(tag, "rel").toLowerCase();
    if (!rel.includes("icon")) continue;
    const href = getAttr(tag, "href");
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) {
      appleIcons.push({ href, size: largestSizeFromSizes(getAttr(tag, "sizes")) });
    } else if (rel === "icon" || rel.includes("shortcut icon")) {
      plainIcons.push(href);
    }
  }
  appleIcons.sort((a, b) => b.size - a.size);
  for (const icon of appleIcons) push(icon.href, "apple_touch_icon");

  // 4) link rel=icon / shortcut icon (png/jpg/webp/unknown only; .ico/.svg dropped by ext filter)
  for (const href of plainIcons) push(href, "link_icon");

  // 5) First <img> in <header>/<nav> whose src|alt|class matches /logo/i
  const containerRe = /<(header|nav)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let container: RegExpExecArray | null;
  const logoRe = /logo/i;
  outer: while ((container = containerRe.exec(source)) !== null) {
    const inner = container[2];
    const imgRe = /<img\b[^>]*>/gi;
    let img: RegExpExecArray | null;
    while ((img = imgRe.exec(inner)) !== null) {
      const tag = img[0];
      const src = getAttr(tag, "src") || getAttr(tag, "data-src");
      const alt = getAttr(tag, "alt");
      const cls = getAttr(tag, "class");
      if (logoRe.test(src) || logoRe.test(alt) || logoRe.test(cls)) {
        push(src, "header_img");
        break outer;
      }
    }
  }

  // Dedupe by resolved URL, preserve priority order, cap at 6.
  const seen = new Set<string>();
  const deduped: LogoCandidate[] = [];
  for (const c of ordered) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    deduped.push(c);
    if (deduped.length >= 6) break;
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Menu link extraction
// ---------------------------------------------------------------------------

export type MenuLink = { url: string; kind: "page" | "pdf" };

const MENU_TEXT_RE = /(menu|menú|carta|메뉴)/i;

function stripTagsInline(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find on-site menu links (page or PDF), same-host only, resolved to absolute
 * https URLs, de-duplicated. `page` links rank before `pdf`; capped at 3.
 */
export function extractMenuLinks(html: string, baseUrl: string): MenuLink[] {
  const source = typeof html === "string" ? html : "";
  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).host.toLowerCase();
  } catch {
    return [];
  }

  const pages: MenuLink[] = [];
  const pdfs: MenuLink[] = [];
  const seen = new Set<string>();

  const anchorRe = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(source)) !== null) {
    const href = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!href) continue;
    const text = stripTagsInline(m[5] ?? "");
    const resolved = resolveUrl(href, baseUrl);
    if (!resolved) continue;
    const parsed = validateImportUrl(resolved);
    if (!parsed.ok) continue;
    if (parsed.url.host.toLowerCase() !== baseHost) continue; // same-host only (v1)

    const isPdf = urlExtension(resolved) === "pdf";
    const matchesMenu = MENU_TEXT_RE.test(href) || MENU_TEXT_RE.test(text);
    if (!matchesMenu) continue;

    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (isPdf) pdfs.push({ url: resolved, kind: "pdf" });
    else pages.push({ url: resolved, kind: "page" });
  }

  return [...pages, ...pdfs].slice(0, 3);
}

// ---------------------------------------------------------------------------
// HTML → plain menu text
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&[a-z]+;/gi, (ent) => ENTITY_MAP[ent.toLowerCase()] ?? ent);
}

/**
 * Reduce raw HTML to readable text for the menu-structuring LLM: drop scripts,
 * styles, noscript, comments and tags; decode basic entities; collapse
 * whitespace; cap at MAX_MENU_TEXT_CHARS.
 */
export function htmlToMenuText(html: string): string {
  const source = typeof html === "string" ? html : "";
  const stripped = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Turn block boundaries into spaces so words don't fuse across tags.
    .replace(/<\/?(p|div|br|li|tr|td|th|h[1-6]|section|article|ul|ol|table)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(stripped);
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, MAX_MENU_TEXT_CHARS);
}

// ---------------------------------------------------------------------------
// Menu structuring prompt (mirrors ai-extract-menu rules for website *text*)
// ---------------------------------------------------------------------------

/**
 * Instruction block for structuring menu items out of website text. Mirrors the
 * grounded, no-invention rules of ai-extract-menu's image prompt, reworded for
 * text input. Snapshot-tested (every prompt change requires fixture coverage).
 */
export function buildSiteMenuPrompt(businessCategory: string): string {
  const label = (businessCategory ?? "").trim() || "local business";
  return [
    `You extract menu line items from the website text of a ${label} on a local deals app.`,
    "",
    "Rules:",
    "- Only include items that literally appear in the website text. Never invent dishes, prices, or items.",
    "- Prefer an empty items list over guessing. If the text does not look like a menu, return no items.",
    "- readable = true for every item you emit (website text is legible by definition; the field is kept for schema parity).",
    "- name = the item as written (concise). category = the menu section heading if present, else empty string.",
    "- price_text = the price exactly as printed (e.g. $4.50) or empty if no price is shown for that item.",
    "- size_options = the sizes/variants printed for that item (e.g. Small, Large, 12 oz, 16 oz). Keep labels exactly as printed. Use [] when none.",
    "- If prices vary by size, keep the full printed size/price text in price_text and also list the sizes in size_options.",
    "- If the text clearly is not a menu (e.g. an About or Contact page), set low_legibility = true and keep items minimal.",
    "- menu_notes: a brief note for the owner (e.g. 'prices not listed') or empty string.",
    "- Extract EVERY distinct item you can read — the owner will pick which ones to use for deals.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Menu schema + normalizer (copied verbatim from ai-extract-menu for parity)
// ---------------------------------------------------------------------------

export type MenuItemRow = {
  name: string;
  category: string;
  price_text: string;
  size_options: string[];
  readable: boolean;
};

export type MenuExtractionResult = {
  items: MenuItemRow[];
  low_legibility: boolean;
  menu_notes: string;
};

export type NormalizedMenuItem = {
  name: string;
  category?: string;
  price_text?: string;
  size_options: string[];
  readable: true;
};

export const menuSchema = {
  name: "menu_extraction",
  strict: true,
  schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            price_text: { type: "string" },
            size_options: {
              type: "array",
              items: { type: "string" },
            },
            readable: { type: "boolean" },
          },
          required: ["name", "category", "price_text", "size_options", "readable"],
          additionalProperties: false,
        },
      },
      low_legibility: { type: "boolean" },
      menu_notes: { type: "string" },
    },
    required: ["items", "low_legibility", "menu_notes"],
    additionalProperties: false,
  },
} as const;

export function normalizeMenuItems(parsed: MenuExtractionResult): NormalizedMenuItem[] {
  return Array.isArray(parsed?.items)
    ? parsed.items
        .filter(
          (r) => r && typeof r.name === "string" && r.name.trim().length > 0 && r.readable === true,
        )
        .map((r) => ({
          name: r.name.trim(),
          category:
            typeof r.category === "string" && r.category.trim() ? r.category.trim() : undefined,
          price_text:
            typeof r.price_text === "string" && r.price_text.trim() ? r.price_text.trim() : undefined,
          size_options: Array.isArray(r.size_options)
            ? r.size_options
                .filter((size) => typeof size === "string" && size.trim().length > 0)
                .map((size) => size.trim())
                .slice(0, 12)
            : [],
          readable: true as const,
        }))
    : [];
}
