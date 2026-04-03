import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { consumeSupabaseAuthDeepLink } from "@/lib/auth-password-recovery";
import { runWhenBridgeSettled } from "@/lib/run-when-bridge-settled";

/**
 * Parses Supabase auth deep links (signup, recovery, magic link) and establishes a session.
 * Navigates to reset-password only for recovery (`type=recovery` or PASSWORD_RECOVERY event).
 */
export function AuthRecoveryLinkHandler() {
  const router = useRouter();
  const initialDone = useRef(false);

  useEffect(() => {
    function goReset() {
      router.replace("/reset-password");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        goReset();
      }
    });

    async function handleUrl(url: string | null) {
      if (!url) return;
      const result = await consumeSupabaseAuthDeepLink(url);
      if (result.ok && result.flow === "recovery") {
        goReset();
      }
    }

    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      void handleUrl(url);
    });

    void (async () => {
      if (initialDone.current) return;
      initialDone.current = true;
      const initial = await Linking.getInitialURL();
      runWhenBridgeSettled(() => {
        void handleUrl(initial);
      });
    })();

    return () => {
      sub.subscription.unsubscribe();
      linkingSub.remove();
    };
  }, [router]);

  return null;
}
