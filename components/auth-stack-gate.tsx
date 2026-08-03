import { useEffect } from "react";
import { useGlobalSearchParams, useRouter, useSegments } from "expo-router";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useRedemptionMode } from "@/components/providers/redemption-mode-provider";
import { buildNextFromRoute, shouldBypassAuthStackGate } from "@/lib/auth-stack-gate";
import { clearUserInitiatedSignOut, isUserInitiatedSignOutPending } from "@/lib/auth-sign-out-intent";

export function AuthStackGate() {
  const router = useRouter();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const { session, isInitialLoading } = useAuthSession();
  const { isLocked, loading: redemptionLoading } = useRedemptionMode();

  useEffect(() => {
    if (session?.user) {
      // Signed in again: any sign-out we were staying out of the way of is over.
      clearUserInitiatedSignOut();
      return;
    }
    if (isInitialLoading || redemptionLoading || isLocked) return;
    const root = String(segments[0] ?? "index");
    if (root === "auth-landing") {
      // The sign-out reached the login screen, so the flag has done its job. Anything
      // that lands on a protected route from here (deep link, expired session) must be
      // gated normally again.
      clearUserInitiatedSignOut();
    }
    if (
      shouldBypassAuthStackGate({
        root,
        isDev: __DEV__,
        userInitiatedSignOut: isUserInitiatedSignOutPending(),
      })
    ) {
      return;
    }
    const next = buildNextFromRoute({
      segments: segments.map(String),
      params: params as Record<string, string | string[] | undefined>,
    });
    router.replace({ pathname: "/auth-landing", params: { next } });
  }, [isInitialLoading, redemptionLoading, isLocked, session?.user, segments, params, router]);

  return null;
}
