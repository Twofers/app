import { useEffect } from "react";
import { useGlobalSearchParams, useRouter, useSegments } from "expo-router";
import { useAuthSession } from "@/components/providers/auth-session-provider";

const PUBLIC_ROOTS = new Set(["index", "auth-landing", "forgot-password", "reset-password"]);

export function AuthStackGate() {
  const router = useRouter();
  const segments = useSegments();
  const params = useGlobalSearchParams();
  const { session, isInitialLoading } = useAuthSession();

  useEffect(() => {
    if (isInitialLoading || session?.user) return;
    const root = String(segments[0] ?? "index");
    if (PUBLIC_ROOTS.has(root)) return;
    if (__DEV__ && root === "debug-diagnostics") return;

    const nextPath = "/" + segments.filter(Boolean).join("/");
    const nextQuery = new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) => {
        if (typeof v === "string") return [[k, v]];
        if (Array.isArray(v)) return v.map((x) => [k, x]);
        return [];
      }),
    ).toString();
    const next = nextQuery.length > 0 ? `${nextPath}?${nextQuery}` : nextPath;
    router.replace({ pathname: "/auth-landing", params: { next } });
  }, [isInitialLoading, session?.user, segments, params, router]);

  return null;
}
