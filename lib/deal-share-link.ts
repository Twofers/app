// Parsing and interpretation for public Share Deal links
// (https://www.twoferapp.com/s/<shareCode>) and their native Expo-normalized
// equivalents (twoforone://s/<shareCode>). Pure logic only so it can be unit
// tested; the Supabase RPC call lives in the deep link handler.

// Must mirror the share-code rules in lookup_deal_share() and lib/share-deal.ts:
// 7 chars from an alphabet that excludes 0, O, I, L, and 1.
const SHARE_CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHARE_NATIVE_SCHEMES = new Set(["twoforone:", "twofer:"]);

export type ShareLinkParse =
  | { type: "none" }
  | { type: "invalid" }
  | { type: "code"; code: string };

/**
 * Detects share links by path shape: any http(s) URL whose path is /s/<segment>,
 * plus native deep links Expo may normalize to scheme://s/<segment>.
 * Returns "none" for URLs that are not share links, "invalid" for share links
 * whose code cannot be a real share code, and the normalized code otherwise.
 */
export function parseShareLink(url: string | null): ShareLinkParse {
  if (!url) return { type: "none" };

  let pathname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      pathname = parsed.pathname;
    } else if (SHARE_NATIVE_SCHEMES.has(parsed.protocol)) {
      // Android App Links can arrive via Expo Router as twoforone://s/ABCDEFG,
      // where "s" is the URL host rather than part of pathname.
      pathname = parsed.hostname === "s" ? `/s${parsed.pathname}` : parsed.pathname;
    } else {
      return { type: "none" };
    }
  } catch {
    return { type: "none" };
  }

  const match = pathname.match(/^\/s\/([^/]+)\/?$/);
  if (!match?.[1]) return { type: "none" };

  let rawCode: string;
  try {
    rawCode = decodeURIComponent(match[1]);
  } catch {
    return { type: "invalid" };
  }

  const code = rawCode.trim().toUpperCase();
  if (!SHARE_CODE_RE.test(code)) return { type: "invalid" };
  return { type: "code", code };
}

export type ShareLookupRow = {
  share_status?: string | null;
  deal_id?: string | null;
};

export type SharedDealResolution =
  | { status: "valid"; dealId: string }
  | { status: "unavailable" }
  | { status: "error" };

/**
 * Interprets the result of the lookup_deal_share RPC. Anything other than a
 * confirmed valid share with a deal id collapses to "unavailable"; transport
 * or RPC errors collapse to "error".
 */
export function interpretShareLookup(
  data: ShareLookupRow[] | ShareLookupRow | null | undefined,
  error: { message?: string } | null | undefined,
): SharedDealResolution {
  if (error) return { status: "error" };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { status: "unavailable" };

  const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
  if (row.share_status === "valid" && dealId && UUID_RE.test(dealId)) {
    return { status: "valid", dealId };
  }
  return { status: "unavailable" };
}
