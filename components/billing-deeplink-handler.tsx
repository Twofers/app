import { useEffect, useRef } from "react";
import * as Linking from "expo-linking";
import { useRouter, type Href } from "expo-router";

import { isMobilePaidBillingEnabled } from "@/lib/billing/access";
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
  // - twoforone://tabs/account/billing?checkout=success
  const hasBillingTarget =
    lower.includes("://billing") ||
    lower.includes(":///billing") ||
    lower.includes("://tabs/billing") ||
    lower.includes("/tabs/billing") ||
    lower.includes("://tabs/account/billing") ||
    lower.includes("/tabs/account/billing") ||
    lower.includes("/account/billing");

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
    if (!isMobilePaidBillingEnabled()) return;

    function navigate(url: string | null) {
      const data = parseBillingDeepLink(url);
      if (!data) return;
      router.replace({
        pathname: "/(tabs)/account/billing",
        params: data.checkout ? { checkout: data.checkout } : {},
      } as unknown as Href);
    }

    const sub = Linking.addEventListener("url", ({ url }) => navigate(url));

    void (async () => {
      if (initialDone.current) return;
      initialDone.current = true;
      const initial = await Linking.getInitialURL();
      if (!parseBillingDeepLink(initial)) return;
      if (!claimInitialUrl()) return;
      runWhenBridgeSettled(() => navigate(initial));
    })();

    return () => sub.remove();
  }, [router]);

  return null;
}

