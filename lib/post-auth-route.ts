import type { Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TabMode } from "./tab-mode";

const BUSINESS_ONLY_TABS = new Set(["create", "redeem", "dashboard", "billing", "account"]);

/** Key used to persist the intended deep-link destination across auth + onboarding screens. */
const PENDING_DEEP_LINK_KEY = "twoforone_pending_deep_link_v1";

/**
 * Save a deep-link destination so it survives through multi-screen auth + setup flows.
 * Called by auth-landing before redirecting to setup screens.
 */
export async function savePendingDeepLink(href: string): Promise<void> {
  if (!href || href === "/(tabs)" || href === "/(tabs)/create" || href === "/(tabs)/dashboard") return;
  try {
    await AsyncStorage.setItem(PENDING_DEEP_LINK_KEY, href);
  } catch {
    /* noop */
  }
}

/**
 * Consume the saved deep-link (returns it and clears storage).
 * Called by setup-completion screens to redirect to the original destination.
 */
export async function consumePendingDeepLink(): Promise<string | null> {
  try {
    const href = await AsyncStorage.getItem(PENDING_DEEP_LINK_KEY);
    if (href) await AsyncStorage.removeItem(PENDING_DEEP_LINK_KEY);
    return href;
  } catch {
    return null;
  }
}

/**
 * `next` from TabAuthGate is a path like "/(tabs)/wallet". For customer post-auth,
 * reject business-only destinations so we do not land on create/redeem/dashboard in customer mode.
 */
export function consumerSafeHrefFromNext(next: string): Href {
  const trimmed = next.trim();
  if (trimmed.startsWith("/deal/") || trimmed.startsWith("/business/")) {
    return trimmed as Href;
  }
  if (!trimmed.startsWith("/(tabs)")) {
    return "/(tabs)" as Href;
  }
  const withoutQuery = trimmed.split("?")[0]?.replace(/\/$/, "") ?? "";
  if (withoutQuery === "/(tabs)") {
    return "/(tabs)" as Href;
  }
  const match = /\/\(tabs\)\/([^/]+)/.exec(withoutQuery);
  const seg = match?.[1];
  if (!seg || BUSINESS_ONLY_TABS.has(seg)) {
    return "/(tabs)" as Href;
  }
  return trimmed as Href;
}

export async function resolvePostAuthReplaceHref(params: {
  role: TabMode;
  nextParam: string | undefined;
}): Promise<Href> {
  const { role, nextParam } = params;
  const next = typeof nextParam === "string" && nextParam.length > 0 ? nextParam : "/(tabs)";

  if (role === "business") {
    const { getBusinessProfileAccessForCurrentUser } = await import("./business-profile-access");
    const access = await getBusinessProfileAccessForCurrentUser();
    if (!access.isComplete) {
      // Preserve the intended destination so business-setup can redirect there after completion.
      await savePendingDeepLink(next);
      return "/business-setup" as Href;
    }
    if (next.startsWith("/(tabs)/billing")) {
      return next as Href;
    }
    return "/(tabs)/create" as Href;
  }

  return consumerSafeHrefFromNext(next);
}
