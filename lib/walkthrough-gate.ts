import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const WALKTHROUGH_KEY = "twoforone_walkthrough_complete";

/**
 * Shared first-time walkthrough gate. Mount the WelcomeWalkthrough on every screen a new
 * merchant might first land on (dashboard, create) — this hook ensures the modal only fires
 * once across all of them via a single AsyncStorage flag.
 */
export function useWalkthroughGate(businessId: string | null | undefined): {
  showWalkthrough: boolean;
  dismissWalkthrough: () => Promise<void>;
} {
  const [showWalkthrough, setShowWalkthrough] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    (async () => {
      const done = await AsyncStorage.getItem(WALKTHROUGH_KEY);
      if (!cancelled && !done) {
        setShowWalkthrough(true);
      }
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  const dismissWalkthrough = useCallback(async () => {
    setShowWalkthrough(false);
    await AsyncStorage.setItem(WALKTHROUGH_KEY, "1");
  }, []);

  return { showWalkthrough, dismissWalkthrough };
}
