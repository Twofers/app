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
  const segment = remainder.split("/")[0] ?? "";
  if (!KNOWN_TAB_SEGMENTS.has(segment)) return null;

  return `/(tabs)/${remainder}` as Href;
}
