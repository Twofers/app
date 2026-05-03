import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";

import { runWhenBridgeSettled } from "@/lib/run-when-bridge-settled";
import { claimInitialUrl } from "@/lib/initial-url-guard";

type BillingCheckout = "success" | "cancel";

function parseBillingDeepLink(url: string | null): { checkout?: BillingCheckout } | null {
  if (!url) return null;

  const lower = url.toLowerCase();
  // Accept common forms:
  // - twoforone://billing?checkout=success
  // - twoforone:///billing?checkout=success
  // - twoforone://tabs/billing?checkout=success
  const hasBillingTarget =
    lower.includes("://billing") ||
    lower.includes(":///billing") ||
    lower.includes("://tabs/billing") ||
    lower.includes("/tabs/billing");

  if (!hasBillingTarget) return null;

  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get("checkout")?.trim().toLowerCase();
    if (raw === "success" || raw === "cancel") {
      return { checkout: raw };
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Handles Stripe checkout deep links into Billing with query preservation.
 * We keep this explicit instead of relying only on implicit router parsing,
 * because checkout return URLs can vary by platform/browser.
 */
export function BillingDeepLinkHandler() {
  const router = useRouter();
  const initialDone = useRef(false);

  useEffect(() => {
    function navigate(url: string | null) {
      const data = parseBillingDeepLink(url);
      if (!data) return;
      router.replace({
        pathname: "/(tabs)/billing",
        params: data.checkout ? { checkout: data.checkout } : {},
      });
    }

    const sub = Linking.addEventListener("url", ({ url }) => navigate(url));

    void (async () => {
      if (initialDone.current) return;
      initialDone.current = true;
      if (!claimInitialUrl()) return;
      const initial = await Linking.getInitialURL();
      runWhenBridgeSettled(() => navigate(initial));
    })();

    return () => sub.remove();
  }, [router]);

  return null;
}

