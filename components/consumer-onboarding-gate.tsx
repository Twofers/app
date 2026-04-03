import { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { useAuthSession } from "@/components/providers/auth-session-provider";
import { useTabMode } from "@/lib/tab-mode";
import { getConsumerPreferences } from "@/lib/consumer-preferences";
import { fetchConsumerProfile, isConsumerProfileComplete } from "@/lib/consumer-profile";

const SKIP_ROOTS = new Set([
  "index",
  "auth-landing",
  "auth-callback",
  "onboarding",
  "consumer-profile-setup",
  "business-setup",
  "forgot-password",
  "reset-password",
]);

/**
 * Customer mode: logged-in users must complete Supabase consumer profile (ZIP + birthday, or legacy age range),
 * then local onboarding (location radius + notifications). No consumer onboarding before auth.
 */
export function ConsumerOnboardingGate() {
  const router = useRouter();
  const segments = useSegments();
  const { mode, ready } = useTabMode();
  const { session, isInitialLoading } = useAuthSession();

  useEffect(() => {
    if (isInitialLoading || !ready) return;
    const root = String(segments[0] ?? "");
    if (SKIP_ROOTS.has(root)) return;
    if (mode !== "customer") return;

    let cancelled = false;
    void (async () => {
      if (cancelled) return;

      const userId = session?.user?.id;
      if (!userId) {
        return;
      }

      const profile = await fetchConsumerProfile(userId);
      if (!isConsumerProfileComplete(profile)) {
        router.replace("/consumer-profile-setup");
        return;
      }

      const prefs = await getConsumerPreferences();
      if (cancelled) return;
      if (!prefs.onboardingComplete) {
        router.replace("/onboarding");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isInitialLoading, ready, mode, segments, router, session?.user?.id]);

  return null;
}
