import type { SubscriptionStatus } from "@/hooks/use-business";

export function isBillingBypassEnabled(skipSetup?: string, e2e?: string): boolean {
  if (!__DEV__) return false;
  return String(e2e ?? "") === "1" || String(skipSetup ?? "") === "1";
}

export function isTrialExpired(trialEndsAt: string | null): boolean {
  if (!trialEndsAt) return true;
  const ms = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(ms)) return true;
  return Date.now() > ms;
}

export function canCreateDeal(params: {
  isLoggedIn: boolean;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  bypass?: boolean;
}): boolean {
  if (!params.isLoggedIn) return true;
  if (params.bypass) return true;
  if (params.subscriptionStatus === "active") return true;
  if (params.subscriptionStatus === "trial" && !isTrialExpired(params.trialEndsAt)) return true;
  return false;
}

