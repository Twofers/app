import * as Linking from "expo-linking";
import type { Href } from "expo-router";

/** Tab route segments under `app/(tabs)/` (omit groups like `(tabs)` from URLs). */
const KNOWN_TAB_SEGMENTS = new Set([
  "index",
  "map",
  "wallet",
  "settings",
  "create",
  "redeem",
  "dashboard",
  "billing",
  "account",
]);

/**
 * Maps mistaken deep links such as `twofer://tabs/redeem` (host `tabs`, path `redeem`)
 * or path `/tabs/redeem` to Expo Router hrefs like `/(tabs)/redeem`.
 */
export function normalizeLegacyTabsDeepLink(url: string | null): Href | null {
  if (!url) return null;
  let parsed: ReturnType<typeof Linking.parse>;
  try {
    parsed = Linking.parse(url);
  } catch {
    return null;
  }

  let remainder: string | null = null;
  const host = (parsed.hostname ?? "").toLowerCase();
  const rawPath = (parsed.path ?? "").replace(/^\/+/, "");

  if (host === "tabs") {
    remainder = rawPath || null;
  } else if (rawPath.startsWith("tabs/")) {
    remainder = rawPath.slice("tabs/".length);
  }

  if (!remainder) return null;
  // Validate every segment, not just the first. Without this, `tabs/redeem/extra/junk`
  // passes the segment check (segment[0]="redeem") and the entire `redeem/extra/junk` is
  // concatenated into the href — Expo Router probably rejects, but it's defensive to
  // refuse anything we don't recognize as a clean tab href.
  const segments = remainder.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const head = segments[0] ?? "";
  if (!KNOWN_TAB_SEGMENTS.has(head)) return null;
  // Allow at most one extra segment after the tab (e.g. /(tabs)/billing/manage). Anything
  // deeper is rejected so we don't synthesize unexpected nested routes.
  if (segments.length > 2) return null;
  // Whatever lives in segment[1+] must be safe-looking (no path traversal, no query bleed).
  if (segments.slice(1).some((s) => !/^[A-Za-z0-9_-]+$/.test(s))) return null;

  return `/(tabs)/${segments.join("/")}` as Href;
}
