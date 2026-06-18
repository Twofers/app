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
  const candidates = buildRouteCandidates(url);

  for (const candidate of candidates) {
    const parts = decodedPathParts(candidate);
    if (parts.length === 0) continue;
    const root = parts[0]?.toLowerCase();
    if (root !== "tabs" && root !== "(tabs)") continue;
    const segment = parts[1] ?? "index";
    if (!KNOWN_TAB_SEGMENTS.has(segment)) continue;
    const remainder = parts.slice(1).join("/");
    return (remainder === "index" ? "/(tabs)" : `/(tabs)/${remainder}`) as Href;
  }

  return null;
}

function buildRouteCandidates(url: string): string[] {
  const candidates: string[] = [];
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || "";
    const path = parsed.pathname.replace(/^\/+/, "");
    if (host || path) candidates.push([host, path].filter(Boolean).join("/"));
    if (path) candidates.push(path);
  } catch {
    candidates.push(url);
  }
  return candidates;
}

function decodedPathParts(path: string): string[] {
  const withoutQuery = path.split(/[?#]/)[0] ?? "";
  const once = decodeRoutePath(withoutQuery);
  if (once == null) return [];
  const decoded = decodeRoutePath(once);
  if (decoded == null) return [];
  return decoded
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function decodeRoutePath(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
