/**
 * Owner-facing claim notifications (spec 11.8 minimum): pure decision and
 * message-building logic for the two v1 push types — "new claim" and "sold out".
 *
 * Kept free of Deno/Supabase imports so the vitest suite can exercise it
 * directly (same pattern as digest-targeting.ts).
 */

export type OwnerPushKind = "new_claim" | "sold_out";
export type OwnerPushLocale = "en" | "es" | "ko";

/** Suppress repeat "new claim" pushes for the same deal inside this window. */
export const OWNER_CLAIM_PUSH_WINDOW_MINUTES = 10;

/** Maps businesses.preferred_locale to a supported push locale (null/unknown → en). */
export function resolveOwnerPushLocale(preferredLocale: string | null | undefined): OwnerPushLocale {
  const v = (preferredLocale ?? "").trim().toLowerCase();
  return v === "es" || v === "ko" ? v : "en";
}

const UNTITLED_DEAL: Record<OwnerPushLocale, string> = {
  en: "your deal",
  es: "tu oferta",
  ko: "내 딜",
};

const CATALOG: Record<
  OwnerPushKind,
  Record<OwnerPushLocale, { title: string; body: (dealTitle: string) => string }>
> = {
  new_claim: {
    en: { title: "New claim", body: (d) => `New claim on “${d}”` },
    es: { title: "Nueva reclamación", body: (d) => `Nueva reclamación de “${d}”` },
    ko: { title: "새 수령", body: (d) => `고객이 “${d}”을(를) 받았습니다` },
  },
  sold_out: {
    en: { title: "Sold out", body: (d) => `“${d}” just sold out` },
    es: { title: "Agotada", body: (d) => `“${d}” se acaba de agotar` },
    ko: { title: "매진", body: (d) => `“${d}”이(가) 매진되었습니다` },
  },
};

export function buildOwnerClaimPushMessage(
  kind: OwnerPushKind,
  locale: OwnerPushLocale,
  dealTitle: string | null | undefined,
): { title: string; body: string } {
  const name = (dealTitle ?? "").trim() || UNTITLED_DEAL[locale];
  const entry = CATALOG[kind][locale];
  return { title: entry.title, body: entry.body(name) };
}

export type OwnerClaimPushInput = {
  /** businesses.claim_notifications_enabled (owner preference, default on). */
  notificationsEnabled: boolean;
  /** deals.max_claims — null or <= 0 means unlimited (never sells out). */
  maxClaims: number | null;
  /** Non-canceled claim count including the claim just inserted; null = unknown. */
  claimCount: number | null;
  nowMs: number;
  /** deals.claim_push_last_sent_at as epoch ms; null = never sent. */
  lastClaimPushAtMs: number | null;
  windowMinutes?: number;
};

/**
 * Decide which owner push (if any) a just-inserted claim should trigger.
 * Sold-out wins over new-claim (the claim is implied) and is never window-suppressed:
 * it fires only for the claim that hits the cap, so it sends once per fill.
 */
export function decideOwnerClaimPush(input: OwnerClaimPushInput): OwnerPushKind | null {
  if (!input.notificationsEnabled) return null;
  if (
    input.maxClaims !== null &&
    input.maxClaims > 0 &&
    input.claimCount !== null &&
    input.claimCount >= input.maxClaims
  ) {
    return "sold_out";
  }
  const windowMs = (input.windowMinutes ?? OWNER_CLAIM_PUSH_WINDOW_MINUTES) * 60_000;
  if (input.lastClaimPushAtMs === null || input.nowMs - input.lastClaimPushAtMs >= windowMs) {
    return "new_claim";
  }
  return null;
}
