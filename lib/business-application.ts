import { EDGE_FUNCTION_TIMEOUT_MS, parseFunctionError } from "@/lib/functions";
import { supabase } from "@/lib/supabase";

// Kept out of lib/functions.ts (a hash-locked AI-poster core file) so the in-app
// business application path can evolve without tripping that gate. Reuses the
// exported timeout + error parser from there without modifying it.

export type OnboardingApplicationStatus = "none" | "pending" | "waitlisted" | "rejected";

export type OnboardingApplicationSummary = {
  status: OnboardingApplicationStatus;
  submitted_at: string | null;
};

const APPLICATION_STATUSES: OnboardingApplicationStatus[] = ["none", "pending", "waitlisted", "rejected"];

/**
 * Narrow accessor for the `application` field that get-business-onboarding-context
 * returns on its `business: null` branch. Read through this instead of widening
 * the BusinessOnboardingContext type, which lives in the locked lib/functions.ts.
 */
export function readOnboardingApplication(context: unknown): OnboardingApplicationSummary | null {
  const application = (context as { application?: unknown } | null | undefined)?.application;
  if (!application || typeof application !== "object") return null;
  const status = (application as { status?: unknown }).status;
  const submittedAt = (application as { submitted_at?: unknown }).submitted_at;
  if (typeof status !== "string" || !APPLICATION_STATUSES.includes(status as OnboardingApplicationStatus)) {
    return null;
  }
  return {
    status: status as OnboardingApplicationStatus,
    submitted_at: typeof submittedAt === "string" ? submittedAt : null,
  };
}

// Surface the server's JSON `{ error }` message (e.g. the rate-limit notice) on a
// non-2xx invoke, mirroring the reader in lib/functions.ts without exporting it.
async function invokeErrorMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (typeof Response !== "undefined" && ctx instanceof Response) {
    try {
      const data = await ctx.clone().json();
      const message = (data as { error?: unknown })?.error;
      if (typeof message === "string" && message) return message;
    } catch {
      /* body wasn't JSON — fall through to the generic parser */
    }
  }
  return parseFunctionError(error);
}

/**
 * File a business application from inside the app — the second front door beside
 * the public website form. The edge function binds the application to the
 * signed-in user's confirmed email, so the owner can later claim it on login.
 * Payment/activation still happens on the website; this only files the
 * application for admin review.
 */
export async function submitBusinessApplication(body: {
  business_name: string;
  contact_name: string;
  phone?: string | null;
  address?: string | null;
  business_type?: string | null;
  website_or_instagram?: string | null;
  terms_accepted: boolean;
  privacy_acknowledged: boolean;
  promo_materials_authorized?: boolean;
}): Promise<{ ok: boolean; onboarding_saved?: boolean }> {
  const { data, error } = await supabase.functions.invoke("submit-business-application", {
    body: { ...body, source: "app_business_setup" },
    timeout: EDGE_FUNCTION_TIMEOUT_MS,
  });
  if (error) {
    throw new Error(await invokeErrorMessage(error));
  }
  if (data && typeof data === "object" && "error" in data) {
    throw new Error(String((data as { error?: string }).error ?? "Could not submit business application."));
  }
  return data as { ok: boolean; onboarding_saved?: boolean };
}
