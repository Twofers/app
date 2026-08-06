import type { TFunction } from "i18next";
import i18n from "./config";

/**
 * Stable `error_code` values from Edge function bodies → locale keys.
 *
 * This is the drift-proof half of the translator. `API_MESSAGE_KEY` below only
 * matches exact English sentences, so any backend copy edit silently demoted a
 * real, actionable error to the generic "Something went wrong." mask (that is
 * exactly how `CUSTOMER_ALREADY_HAS_ACTIVE_DEAL` regressed). Codes are part of
 * the response contract and do not get reworded, so prefer them whenever the
 * caller threads one through (`getErrorCode` in `lib/functions.ts`).
 */
const API_ERROR_CODE_KEY: Record<string, string> = {
  CUSTOMER_ALREADY_HAS_ACTIVE_DEAL: "apiErrors.claimActiveAppWide",
  BUSINESS_REPEAT_LIMIT_FOREVER: "apiErrors.claimRepeatFirstTimeOnly",
  // Date-less variant: the code alone cannot carry `nextEligibleAt`. When the
  // server message is present the prefix branch below wins and shows the date.
  BUSINESS_REPEAT_LIMIT_COOLDOWN: "apiErrors.claimRepeatCooldownSoon",
  DEAL_NOT_ELIGIBLE: "apiErrors.claimNotEligible",
  BUSINESS_NEW_CLAIMS_DISABLED: "apiErrors.claimBusinessNotAccepting",
};

/**
 * Exact English strings from Edge functions, `parseFunctionError` fallbacks,
 * and legacy scan copy.
 */
const API_MESSAGE_KEY: Record<string, string> = {
  "Unknown error": "apiErrors.unknown",
  "Server returned an error": "apiErrors.serverError",
  "No token returned from server": "apiErrors.noToken",
  "Token redemption failed": "apiErrors.redeemFailed",

  "Method not allowed": "apiErrors.methodNotAllowed",
  "Invalid JSON in request body": "apiErrors.invalidJsonBody",
  "Too many attempts. Try again in 30 seconds.": "apiErrors.rateLimit30s",
  // submit-business-application's flood ceiling (429). Reaches the client as the
  // server's JSON `error` field via invokeErrorMessage.
  "Too many requests. Please try again later.": "apiErrors.rateLimitTryLater",
  "Server error": "apiErrors.serverErrorGeneric",

  "Unauthorized. Please log in.": "apiErrors.claimUnauthorized",
  "Missing deal_id": "apiErrors.claimMissingDealId",
  "Deal not found": "businessScan.msgDealNotFound",
  "This deal is not active": "apiErrors.claimDealInactive",
  "This deal has not started yet.": "apiErrors.claimNotStarted",
  "This deal has expired": "apiErrors.claimExpired",
  "This deal is not configured correctly.": "apiErrors.claimRecurringMisconfigured",
  "This deal is not active today.": "apiErrors.claimNotActiveToday",
  "This deal has an invalid time window.": "apiErrors.claimInvalidWindow",
  "This deal is not active right now.": "apiErrors.claimNotActiveNow",
  "Claiming has closed for today's window.": "apiErrors.claimWindowClosed",
  "You already have an active claim for this deal": "apiErrors.claimDuplicateActive",
  "You already have an active claim from this business. Redeem or wait for it to expire before claiming another offer.":
    "apiErrors.claimActiveOtherDeal",
  // Current claim-deal wording (409 CUSTOMER_ALREADY_HAS_ACTIVE_DEAL). The two
  // entries below it are earlier wordings, kept so an older deployed function
  // build still translates instead of falling through to the generic mask.
  "You already have an active deal in your wallet. Redeem it, let it expire, or release it before claiming another.":
    "apiErrors.claimActiveAppWide",
  "You already have an active claim. Redeem it or wait until it expires before claiming another deal.":
    "apiErrors.claimActiveAppWide",
  "You can only claim once per business per local day while your claim is still redeemable. Redeem it or wait until it expires before claiming another deal from this business.":
    "apiErrors.claimDailyLimitBusiness",
  "You can only claim once per business per day. Try again tomorrow.": "apiErrors.claimDailyLimitBusiness",
  "You can only claim once per business per day. Try again the next local day.":
    "apiErrors.claimDailyLimitBusiness",
  "You can only claim one deal per hour. Please try again shortly.": "apiErrors.claimHourlyLimit",
  "This deal has reached its claim limit.": "apiErrors.claimSoldOut",
  "This deal is not eligible to claim.": "apiErrors.claimNotEligible",
  "This business is not accepting new deal claims.": "apiErrors.claimBusinessNotAccepting",
  // Business repeat-claim policy (_shared/repeat-claim-policy.ts). The COOLDOWN
  // twin is a prefix match, not an exact one — it carries a timestamp.
  "This business limits deals to first-time Twofer customers. You have already redeemed a deal here.":
    "apiErrors.claimRepeatFirstTimeOnly",

  "Unauthorized. Please log in as a business owner.": "apiErrors.redeemUnauthorized",
  "You must be a business owner to redeem tokens.": "apiErrors.redeemNotBusinessOwner",
  // Redemption Mode session gates (staff-redemption edge fn + preview/confirm RPC):
  // show a clear "turn on Redemption Mode" message instead of raw server text.
  "This endpoint is only for Redemption Mode staff sessions.": "apiErrors.redeemRedemptionModeInactive",
  "Redemption session is not active.": "apiErrors.redeemRedemptionModeInactive",
  "Missing or invalid token": "apiErrors.redeemTokenMissing",
  "Missing or invalid token or claim code": "apiErrors.redeemTokenOrCodeMissing",
  "Invalid token": "apiErrors.redeemTokenInvalid",
  "Invalid token or claim code": "apiErrors.redeemInvalidCode",
  "This token does not belong to your business": "apiErrors.redeemTokenWrongBusiness",
  "This token has already been redeemed": "apiErrors.redeemTokenAlreadyUsed",
  "This token has expired": "apiErrors.redeemTokenExpired",
  "This claim cannot be redeemed": "apiErrors.redeemClaimCannotRedeem",
  "Claim not found": "apiErrors.claimNotFound",
  "This claim does not belong to you": "apiErrors.claimWrongUser",
  "This claim cannot be used right now": "apiErrors.redeemCannotUseNow",
  "Could not start redemption. Try again.": "apiErrors.redeemStartFailed",
  "Could not complete redemption. Try again.": "apiErrors.redeemCompleteFailed",
  "Redemption was not started for this claim": "apiErrors.redeemNotStarted",
  "Redemption session expired. Start again from your wallet.": "apiErrors.redeemSessionExpired",
  "Redemption window has not finished yet": "apiErrors.redeemWindowNotFinished",
  "Missing claim_id": "apiErrors.missingClaimId",

  "Invalid QR code format": "businessScan.msgInvalidFormat",
  "Deal redeemed successfully!": "businessScan.msgRedeemSuccess",

  // businesses_require_invite trigger v3 (migration 20260814130000): one
  // self-created business per owner during the pilot.
  "business limit reached": "apiErrors.businessLimitReached",

  // Identity lock (migration 20260816120000): stable token raised by the
  // businesses trigger and returned by update-business-profile-section when a
  // publicly visible business tries to rename itself directly.
  "business_name_locked": "apiErrors.businessNameLocked",

  "Missing business_id, photo_path, or hint_text.": "apiErrors.aiAdsMissingFields",
  "You do not own this business.": "apiErrors.notBusinessOwner",
  "Could not access the photo. Upload again.": "apiErrors.photoAccessFailed",
  "Failed to access photo.": "apiErrors.photoAccessFailed",
  "OPENAI_API_KEY is not set. Add it to Supabase secrets.": "apiErrors.aiOpenaiNotConfigured",
  "OPENAI_API_KEY is not set. Please add it to Supabase secrets.": "apiErrors.aiOpenaiNotConfigured",
  "AI generation failed.": "apiErrors.aiGenerationFailed",
  "AI response was invalid JSON.": "apiErrors.aiInvalidJson",
  "AI returned an invalid set of ads. Tap try again.": "apiErrors.aiInvalidAds",
  "AI response was invalid.": "apiErrors.aiResponseInvalid",
  "Missing required fields.": "apiErrors.aiMissingRequiredFields",
  "Failed to create deal.": "apiErrors.aiFailedCreateDeal",
  "Missing hint_text.": "apiErrors.aiMissingHint",
  "Regeneration limit reached for this draft. Edit the text below or start a new offer.":
    "apiErrors.aiRegenerationLimit",

  // request-business-on-twofer / public-local-businesses (consumer demand capture).
  "Sign in to request this business.": "requestBusiness.errSignIn",
  "Could not save this request.": "requestBusiness.errGeneric",
  "Business requests are not configured.": "requestBusiness.errGeneric",
  "Could not load local businesses.": "requestBusiness.errSearchFailed",
  "Local businesses are not configured.": "requestBusiness.errSearchFailed",
  "Choose one business to request.": "requestBusiness.errGeneric",
};

const CUTOFF_PREFIX = "Claiming has closed. Cutoff was ";
const FAILED_CREATE_CLAIM_PREFIX = "Failed to create claim: ";
const FAILED_REDEEM_PREFIX = "Failed to redeem token: ";
/** `_shared/repeat-claim-policy.ts` appends a raw ISO instant + "." to this. */
const REPEAT_COOLDOWN_PREFIX = "You can claim another deal from this business on ";

/**
 * Renders the repeat-claim cooldown's ISO instant as a readable local date.
 * Returns null when the tail isn't a parsable timestamp, so the caller can fall
 * back to date-less copy rather than printing `2026-08-01T14:00:00.000Z` at a
 * customer.
 */
function formatRepeatEligibleDate(rawTail: string): string | null {
  const iso = rawTail.trim().replace(/\.$/, "");
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

/** Substrings / patterns for Postgres, PostgREST, auth, network, and Edge Function infra (EN). */
const DB_OR_INFRA_HINTS: { pattern: RegExp; key: string }[] = [
  { pattern: /row-level security|RLS|permission denied for table/i, key: "apiErrors.dbRlsViolation" },
  { pattern: /duplicate key|unique constraint/i, key: "apiErrors.dbDuplicate" },
  { pattern: /foreign key constraint/i, key: "apiErrors.dbForeignKey" },
  { pattern: /JWT expired|jwt expired|token expired|session expired|Invalid Refresh Token/i, key: "apiErrors.sessionExpired" },
  { pattern: /email not confirmed/i, key: "apiErrors.authEmailNotConfirmed" },
  {
    pattern: /invalid login credentials|Invalid login credentials|User not found/i,
    key: "apiErrors.authInvalidCredentials",
  },
  { pattern: /network request failed|Failed to fetch|NetworkError/i, key: "apiErrors.networkFailed" },
  { pattern: /violates check constraint/i, key: "apiErrors.dbCheckViolation" },
  // Defense-in-depth: never surface the bare Supabase wrapper if a non-2xx
  // edge response slips past a caller's own mapping (e.g. claimDeal/redeemToken).
  { pattern: /edge function returned a non-?2xx status/i, key: "apiErrors.operationFailedTryAgain" },
  { pattern: /requested function was not found|function was not found/i, key: "apiErrors.operationFailedTryAgain" },
];

function looksLikeInternalOrDbMessage(s: string): boolean {
  const t = s.toLowerCase();
  return (
    t.includes("violates") ||
    t.includes("constraint") ||
    t.includes("postgres") ||
    t.includes("supabase") ||
    /\b23505|23503|42501|42P01|PGRST\d+\b/i.test(s) ||
    s.length > 180
  );
}

function translateByExactOrPrefix(s: string, t: TFunction): string | null {
  const i18nKey = API_MESSAGE_KEY[s];
  if (i18nKey) {
    const translated = String(t(i18nKey));
    if (translated !== i18nKey) return translated;
  }
  if (s.startsWith(CUTOFF_PREFIX)) {
    return String(t("apiErrors.claimCutoffClosed", { time: s.slice(CUTOFF_PREFIX.length) }));
  }
  if (s.startsWith(FAILED_CREATE_CLAIM_PREFIX)) {
    return String(t("apiErrors.claimCreateFailed", { detail: s.slice(FAILED_CREATE_CLAIM_PREFIX.length) }));
  }
  if (s.startsWith(FAILED_REDEEM_PREFIX)) {
    return String(t("apiErrors.redeemUpdateFailed", { detail: s.slice(FAILED_REDEEM_PREFIX.length) }));
  }
  if (s.startsWith(REPEAT_COOLDOWN_PREFIX)) {
    const date = formatRepeatEligibleDate(s.slice(REPEAT_COOLDOWN_PREFIX.length));
    return String(date ? t("apiErrors.claimRepeatCooldown", { date }) : t("apiErrors.claimRepeatCooldownSoon"));
  }
  return null;
}

function translateByHeuristic(s: string, t: TFunction): string | null {
  for (const { pattern, key } of DB_OR_INFRA_HINTS) {
    if (pattern.test(s)) {
      const out = String(t(key));
      if (out !== key) return out;
    }
  }
  if (looksLikeInternalOrDbMessage(s)) {
    const k = "apiErrors.operationFailedTryAgain";
    const out = String(t(k));
    if (out !== k) return out;
  }
  return null;
}

/**
 * Map a known API / Edge Function error to locale JSON, preferring the stable
 * `error_code` over the English message.
 *
 * Resolution order, and why:
 *   1. exact / prefix message match — the only branch that can interpolate data
 *      the code cannot carry (cutoff time, cooldown date), so it goes first;
 *      it simply misses when the backend reworded the sentence.
 *   2. `error_code` — reworded copy still lands on the right localized string.
 *   3. DB / infra heuristics, then a generic mask, so source-language or
 *      internal server text never leaks into non-English UI.
 */
export function translateApiError(
  params: { code?: string | null; message?: string | null },
  t: TFunction,
): string {
  const s = (params.message ?? "").trim();
  if (s) {
    const fromStructured = translateByExactOrPrefix(s, t);
    if (fromStructured !== null) return fromStructured;
  }
  const code = (params.code ?? "").trim();
  if (code) {
    const codeKey = API_ERROR_CODE_KEY[code];
    if (codeKey) {
      const translated = String(t(codeKey));
      if (translated !== codeKey) return translated;
    }
  }
  if (s) {
    const fromHeuristic = translateByHeuristic(s, t);
    if (fromHeuristic !== null) return fromHeuristic;
  }
  const fallbackKey = "apiErrors.operationFailedTryAgain";
  const fallback = String(t(fallbackKey));
  return fallback !== fallbackKey ? fallback : "Something went wrong. Try again.";
}

/**
 * Message-only entry point. Prefer `translateApiError` at call sites that can
 * reach the thrown error's `error_code` (see `getErrorCode` in `lib/functions.ts`).
 */
export function translateKnownApiMessage(raw: string, t: TFunction): string {
  return translateApiError({ message: raw }, t);
}
