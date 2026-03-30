import type { TFunction } from "i18next";

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
  "You already have an active claim. Redeem it or wait until it expires before claiming another deal.":
    "apiErrors.claimActiveAppWide",
  "You can only claim once per business per local day while your claim is still redeemable. Redeem it or wait until it expires before claiming another deal from this business.":
    "apiErrors.claimDailyLimitBusiness",
  "You can only claim once per business per day. Try again tomorrow.": "apiErrors.claimDailyLimitBusiness",
  "You can only claim once per business per day. Try again the next local day.":
    "apiErrors.claimDailyLimitBusiness",
  "You can only claim one deal per hour. Please try again shortly.": "apiErrors.claimHourlyLimit",
  "This deal has reached its claim limit.": "apiErrors.claimSoldOut",

  "Unauthorized. Please log in as a business owner.": "apiErrors.redeemUnauthorized",
  "You must be a business owner to redeem tokens.": "apiErrors.redeemNotBusinessOwner",
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

  "Missing business_id, photo_path, or hint_text.": "apiErrors.aiAdsMissingFields",
  "You do not own this business.": "apiErrors.notBusinessOwner",
  "Could not access the photo. Upload again.": "apiErrors.photoAccessFailed",
  "Failed to access photo.": "apiErrors.photoAccessFailed",
  "Demo generation failed.": "apiErrors.aiDemoGenerationFailed",
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
};

const CUTOFF_PREFIX = "Claiming has closed. Cutoff was ";
const FAILED_CREATE_CLAIM_PREFIX = "Failed to create claim: ";
const FAILED_REDEEM_PREFIX = "Failed to redeem token: ";

/** Substrings / patterns for Postgres, PostgREST, auth, and network (EN). */
const DB_OR_INFRA_HINTS: { pattern: RegExp; key: string }[] = [
  { pattern: /row-level security|RLS|permission denied for table/i, key: "apiErrors.dbRlsViolation" },
  { pattern: /duplicate key|unique constraint/i, key: "apiErrors.dbDuplicate" },
  { pattern: /foreign key constraint/i, key: "apiErrors.dbForeignKey" },
  { pattern: /JWT expired|jwt expired|token expired|session expired|Invalid Refresh Token/i, key: "apiErrors.sessionExpired" },
  {
    pattern: /invalid login credentials|Invalid login credentials|User not found|Email not confirmed/i,
    key: "apiErrors.authInvalidCredentials",
  },
  { pattern: /network request failed|Failed to fetch|NetworkError/i, key: "apiErrors.networkFailed" },
  { pattern: /violates check constraint/i, key: "apiErrors.dbCheckViolation" },
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
 * Map known English API / Edge Function messages to locale JSON.
 * Unknown user-facing English passes through; likely DB/internal errors get a generic localized line.
 */
export function translateKnownApiMessage(raw: string, t: TFunction): string {
  const s = raw.trim();
  const fromStructured = translateByExactOrPrefix(s, t);
  if (fromStructured !== null) return fromStructured;
  const fromHeuristic = translateByHeuristic(s, t);
  if (fromHeuristic !== null) return fromHeuristic;
  return raw;
}
