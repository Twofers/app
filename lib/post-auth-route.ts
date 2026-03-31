import type { Href } from "expo-router";
import type { TabMode } from "./tab-mode";

const BUSINESS_ONLY_TABS = new Set(["create", "redeem", "dashboard", "billing", "account"]);

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
      return "/business-setup" as Href;
    }
    if (next.startsWith("/(tabs)/billing")) {
      return next as Href;
    }
    return "/(tabs)/create" as Href;
  }

  return consumerSafeHrefFromNext(next);
}
