/**
 * Small display-only formatters. These never change stored data — they only
 * make free-text business fields read consistently in lists and cards.
 */

/**
 * Compact a free-text business location for list cards.
 *
 * Business `location` strings vary from "Grapevine, TX" to full geocoder
 * output like "9460 N MacArthur Blvd, Irving, TX 75063, USA". List cards want
 * the short "City, ST" form; detail screens keep the full address.
 *
 * Heuristic: only rewrite strings that look like a US geocoder address
 * (3+ comma parts with a trailing "USA"/"US" or a "ST 12345" part). Anything
 * else is returned untouched so international or hand-typed values are safe.
 */
export function compactLocationLabel(location: string | null | undefined): string {
  const raw = (location ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return raw;

  let end = parts.length;
  if (/^(usa|us|united states( of america)?)$/i.test(parts[end - 1])) {
    end -= 1;
  }
  if (end < 2) return raw;

  // Expect "... , City, ST 12345" or "... , City, ST" once the country is gone.
  const stateZip = parts[end - 1].match(/^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (!stateZip) return raw;
  const city = parts[end - 2];
  if (!city || /\d/.test(city)) return raw;
  return `${city}, ${stateZip[1].toUpperCase()}`;
}

/**
 * Format a free-text menu price for display. Owners type prices however they
 * like ("4.25", "1.5", "$3", "Market price", "Sm 4 / Lg 6"). When the value is
 * a bare number — optionally with a leading "$" — we render it as US currency
 * ("$1.50"). Anything carrying other text is returned untouched so ranges,
 * notes, and hand-typed formats are safe. Display only; never mutates storage.
 */
export function formatMenuPriceLabel(price: string | null | undefined): string {
  const raw = (price ?? "").trim();
  if (!raw) return "";
  const bare = raw.replace(/^\$\s*/, "");
  if (!/^\d+(\.\d+)?$/.test(bare)) return raw;
  const n = Number(bare);
  if (!Number.isFinite(n)) return raw;
  return `$${n.toFixed(2)}`;
}

/**
 * Format a stored phone number for display. Storage keeps whatever the owner
 * entered (often E.164 like "+12142366549"); screens show "(214) 236-6549".
 * Numbers that aren't 10-digit US numbers are returned untouched.
 */
export function formatPhoneLabel(phone: string | null | undefined): string {
  const raw = (phone ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return raw;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
