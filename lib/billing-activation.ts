import { Platform } from "react-native";

import { supabase } from "./supabase";
import { EDGE_FUNCTION_TIMEOUT_MS, getErrorCode, parseFunctionError } from "./functions";

/**
 * Approved-but-not-activated merchants used to be sent to the static
 * /business/billing/start page, which can only tell them to go dig the
 * single-use activation link out of their approval email — the app has no way
 * to reconstruct that emailed token.
 *
 * stripe-create-checkout-session already accepts an authenticated caller with
 * no token (userCanBillBusiness: owner, active owner/manager member, or an
 * active billing admin), so the signed-in owner can mint their own Stripe
 * Checkout URL and go straight there. Checkout itself still happens on
 * Stripe-hosted web — nothing is collected in the app.
 *
 * Every server-side guard is unchanged: purchase_surface must be web_only, the
 * approved_activation_gate flag must be on, the business must still be
 * approved_not_activated with a claimed application, and the 30-day trial and
 * price are resolved server-side.
 */

export type TrialCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; message: string; code?: string };

/** Dedicated client gate; Android remains closed even when the flag is true. */
export function isIosTrialCheckoutEnabled(): boolean {
  return Platform.OS === "ios" && process.env.EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT === "true";
}

/** Checkout sessions created by this flow must stay on Stripe's hosted origin. */
export function isAllowedStripeCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com";
  } catch {
    return false;
  }
}

// Mirrors readInvokeErrorBody in lib/business-terms.ts: edge functions return
// `{ error, error_code }` JSON on non-2xx responses, but supabase-js wraps that
// in a FunctionsHttpError whose body isn't pre-read.
async function readInvokeErrorBody(error: unknown): Promise<{ message?: string; code?: string }> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const data = await ctx.clone().json();
      if (data && typeof data === "object") {
        const o = data as { error?: unknown; error_code?: unknown };
        return {
          message: typeof o.error === "string" ? o.error : undefined,
          code: typeof o.error_code === "string" ? o.error_code : undefined,
        };
      }
    } catch {
      /* body wasn't JSON, or was already consumed — fall back to sync parsing */
    }
  }
  return {};
}

/**
 * Mints a Stripe Checkout URL for the signed-in owner's approved trial.
 *
 * Never throws: callers remain on the localized approval-email/support path.
 * `locale` is the app's current i18n language; the server normalizes it to a
 * Stripe locale.
 */
export async function createTrialCheckoutUrl(
  businessId: string,
  locale?: string,
): Promise<TrialCheckoutResult> {
  if (!isIosTrialCheckoutEnabled()) {
    return {
      ok: false,
      message: "Trial Checkout is not available on this device.",
      code: "IOS_TRIAL_CHECKOUT_UNAVAILABLE",
    };
  }
  if (!businessId) {
    return { ok: false, message: "Business account is required.", code: "BUSINESS_ID_REQUIRED" };
  }

  try {
    const { data, error } = await supabase.functions.invoke("stripe-create-checkout-session", {
      body: { business_id: businessId, source: "native_ios", ...(locale ? { locale } : {}) },
      timeout: EDGE_FUNCTION_TIMEOUT_MS,
    });

    if (error) {
      const fromBody = await readInvokeErrorBody(error);
      return {
        ok: false,
        message: fromBody.message ?? parseFunctionError(error),
        code: fromBody.code ?? getErrorCode(error),
      };
    }

    const body = (data ?? {}) as { checkout_url?: unknown; error?: unknown; error_code?: unknown };
    if (typeof body.error === "string") {
      return {
        ok: false,
        message: body.error,
        code: typeof body.error_code === "string" ? body.error_code : undefined,
      };
    }

    const url = typeof body.checkout_url === "string" ? body.checkout_url : "";
    if (!url) return { ok: false, message: "Checkout link was not returned." };
    if (!isAllowedStripeCheckoutUrl(url)) {
      return {
        ok: false,
        message: "Checkout returned an unsupported destination.",
        code: "CHECKOUT_URL_NOT_ALLOWED",
      };
    }
    return { ok: true, url };
  } catch (err) {
    return { ok: false, message: parseFunctionError(err), code: getErrorCode(err) };
  }
}
