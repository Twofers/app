import { useEffect } from "react";
import { useGlobalSearchParams, useRouter, useSegments } from "expo-router";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useRedemptionMode } from "@/components/providers/redemption-mode-provider";
import { buildNextFromRoute, shouldBypassAuthStackGate } from "@/lib/auth-stack-gate";

export function AuthStackGate() {
  const router = useRouter();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const { session, isInitialLoading } = useAuthSession();
  const { isLocked, loading: redemptionLoading } = useRedemptionMode();

  useEffect(() => {
    if (isInitialLoading || redemptionLoading || isLocked || session?.user) return;
    const root = String(segments[0] ?? "index");
    if (shouldBypassAuthStackGate({ root, isDev: __DEV__ })) return;
    const next = buildNextFromRoute({
      segments: segments.map(String),
      params: params as Record<string, string | string[] | undefined>,
    });
    router.replace({ pathname: "/auth-landing", params: { next } });
  }, [isInitialLoading, redemptionLoading, isLocked, session?.user, segments, params, router]);

  return null;
}
