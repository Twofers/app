import type { TabMode } from "./tab-mode";

const BUSINESS_TABS = new Set(["create", "redeem", "dashboard", "billing", "account"]);
const CONSUMER_TABS = new Set(["index", "map", "wallet", "settings"]);

export function deriveTabFromSegments(segments: string[]): string {
  const tabsIdx = segments.indexOf("(tabs)");
  if (tabsIdx === -1) return "index";
  return String(segments[tabsIdx + 1] ?? "index");
}

export function shouldCheckBusinessProfileForTab(tab: string): boolean {
  return BUSINESS_TABS.has(tab);
}

export function resolveTabModeRedirectTarget({
  mode,
  tab,
  currentPath,
  forceBypass,
  checkingProfile,
  businessProfileComplete,
  businessBillingBlocked = false,
}: {
  mode: TabMode;
  tab: string;
  currentPath: string;
  forceBypass: boolean;
  checkingProfile: boolean;
  businessProfileComplete: boolean | null;
  businessBillingBlocked?: boolean;
}): string | null {
  const safeReturn = (target: string) => (target === currentPath ? null : target);

  if (mode === "business") {
    if (CONSUMER_TABS.has(tab)) return safeReturn("/(tabs)/create");
    if (BUSINESS_TABS.has(tab)) {
      if (forceBypass || checkingProfile || businessProfileComplete === null) return null;
      if (!businessProfileComplete) return safeReturn("/business-setup");
      if (businessBillingBlocked && tab !== "billing") return safeReturn("/(tabs)/billing?reason=reactivate");
    }
    return null;
  }

  if (tab === "account") return safeReturn("/(tabs)/settings");
  if (BUSINESS_TABS.has(tab)) return safeReturn("/(tabs)");
  return null;
}
