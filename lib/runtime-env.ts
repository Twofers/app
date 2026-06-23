import Constants from "expo-constants";

/**
 * Build-time and runtime public configuration (no secrets).
 * `EXPO_PUBLIC_*` are inlined at bundle time; EAS must define them per profile (preview vs production).
 */

export type AppExtra = {
  gitCommit?: string | null;
  easBuildProfile?: string | null;
};

export function getAppExtra(): AppExtra {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  return {
    gitCommit: typeof extra?.gitCommit === "string" ? extra.gitCommit : null,
    easBuildProfile: typeof extra?.easBuildProfile === "string" ? extra.easBuildProfile : null,
  };
}

export function getExpoAppVersion(): string {
  return (
    Constants.expoConfig?.version ??
    (Constants as { nativeApplicationVersion?: string }).nativeApplicationVersion ??
    "unknown"
  );
}

export function getNativeBuildLabel(): string {
  const c = Constants as { nativeBuildVersion?: string; nativeApplicationVersion?: string };
  const v = c.nativeApplicationVersion;
  const b = c.nativeBuildVersion;
  if (v && b) return `${v} (${b})`;
  return v ?? b ?? "unknown";
}

export function getExecutionEnvironment(): string {
  return Constants.executionEnvironment ?? "unknown";
}

/**
 * Human-readable build channel: local Metro, EAS profile (preview/production/development), or generic release.
 */
export function getBuildProfileLabel(): string {
  if (__DEV__) return "development";
  const p = getAppExtra().easBuildProfile;
  if (typeof p === "string" && p.trim().length > 0) return p.trim();
  return "release";
}

/** True for EAS `preview` / `development` client builds (set via app.config extra), or when forced by env. */
export function isPreviewOrDevClientProfile(): boolean {
  if (__DEV__) return true;
  if (process.env.EXPO_PUBLIC_PREVIEW_MATCHES_DEV === "true") return true;
  const p = getAppExtra().easBuildProfile;
  return p === "preview" || p === "development";
}

export function getSupabaseUrlForDisplay(): string {
  const u = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!u) return "(missing)";
  try {
    const { host } = new URL(u);
    return host;
  } catch {
    return "(invalid URL)";
  }
}

export function isSupabaseConfigured(): boolean {
  const u = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const k = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(u && k);
}

export function getPublicEnvSnapshot(): Record<string, string> {
  return {
    EXPO_PUBLIC_SUPABASE_URL: getSupabaseUrlForDisplay(),
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim()
      ? `set (${process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY.trim().length} chars)`
      : "missing",
    EXPO_PUBLIC_PRIVACY_POLICY_URL: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() ?? "(default)",
    EXPO_PUBLIC_TERMS_OF_SERVICE_URL: process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL?.trim() ?? "(default)",
    EXPO_PUBLIC_SUPPORT_URL: process.env.EXPO_PUBLIC_SUPPORT_URL?.trim() ?? "(default)",
    EXPO_PUBLIC_DELETE_ACCOUNT_URL: process.env.EXPO_PUBLIC_DELETE_ACCOUNT_URL?.trim() ?? "(default)",
    EXPO_PUBLIC_ENABLE_SHARE_DEAL: process.env.EXPO_PUBLIC_ENABLE_SHARE_DEAL ?? "(unset)",
    AI_V4_COMPOSED_AD_CARD_ENABLED: process.env.AI_V4_COMPOSED_AD_CARD_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED: process.env.EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED ?? "(unset)",
    AI_V4_SHARED_RENDERER_ENABLED: process.env.AI_V4_SHARED_RENDERER_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED: process.env.EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED ?? "(unset)",
    AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED: process.env.AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED: process.env.EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED ?? "(unset)",
    AI_V4_PRESENTATION_RESOLVER_ENABLED: process.env.AI_V4_PRESENTATION_RESOLVER_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED: process.env.EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED ?? "(unset)",
    AI_V4_MINIMAL_INPUT_FLOW_ENABLED: process.env.AI_V4_MINIMAL_INPUT_FLOW_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED: process.env.EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED ?? "(unset)",
    AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED: process.env.AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED: process.env.EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED ?? "(unset)",
    AI_V4_COMPOSITE_QA_ENABLED: process.env.AI_V4_COMPOSITE_QA_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED: process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED ?? "(unset)",
    AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED: process.env.AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED: process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED ?? "(unset)",
    AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED: process.env.AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED: process.env.EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED ?? "(unset)",
    AI_V5_MULTILINGUAL_FOUNDATION_ENABLED: process.env.AI_V5_MULTILINGUAL_FOUNDATION_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED: process.env.EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED ?? "(unset)",
    AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED: process.env.AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED: process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED ?? "(unset)",
    AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED: process.env.AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED: process.env.EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED ?? "(unset)",
    AI_V5_LOCALIZED_OWNER_UI_ENABLED: process.env.AI_V5_LOCALIZED_OWNER_UI_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED: process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED ?? "(unset)",
    AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED: process.env.AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED: process.env.EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED ?? "(unset)",
    AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED: process.env.AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED ?? "(unset)",
    EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED: process.env.EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED ?? "(unset)",
    EXPO_PUBLIC_SHOW_DEBUG_PANEL: process.env.EXPO_PUBLIC_SHOW_DEBUG_PANEL?.trim() ?? "(unset)",
    EXPO_PUBLIC_DEBUG_BOOT_LOG: process.env.EXPO_PUBLIC_DEBUG_BOOT_LOG?.trim() ?? "(unset)",
    EXPO_PUBLIC_PREVIEW_MATCHES_DEV: process.env.EXPO_PUBLIC_PREVIEW_MATCHES_DEV?.trim() ?? "(unset)",
    EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?.trim()
      ? "set"
      : "(unset)",
    NODE_ENV: process.env.NODE_ENV ?? "unknown",
  };
}

export function isShareDealEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_SHARE_DEAL === "true";
}

export function isAiV4ComposedAdCardEnabled(): boolean {
  return process.env.AI_V4_COMPOSED_AD_CARD_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED === "true";
}

export function isAiV4SharedRendererEnabled(): boolean {
  return process.env.AI_V4_SHARED_RENDERER_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED === "true";
}

export function isAiV4AuthoritativeOfferCardEnabled(): boolean {
  return process.env.AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED === "true";
}

export function isAiV4PresentationResolverEnabled(): boolean {
  return process.env.AI_V4_PRESENTATION_RESOLVER_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED === "true";
}

export function isAiV4MinimalInputFlowEnabled(): boolean {
  return process.env.AI_V4_MINIMAL_INPUT_FLOW_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED === "true";
}

export function isAiV4InstantStyleAlternatesEnabled(): boolean {
  return process.env.AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED === "true";
}

export function isAiV4CompositeQaEnabled(): boolean {
  return process.env.AI_V4_COMPOSITE_QA_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED === "true";
}

export function isAiV4CompositeScreenshotQaEnabled(): boolean {
  return process.env.AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED === "true";
}

export function isAiV4ExactPresentationApprovalEnabled(): boolean {
  return process.env.AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED === "true";
}

export function isAiV5MultilingualFoundationEnabled(): boolean {
  return process.env.AI_V5_MULTILINGUAL_FOUNDATION_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED === "true";
}

export function isAiV5LocalizedOfferRendererEnabled(): boolean {
  return process.env.AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED === "true";
}

export function isAiV5KoreanCounterRegistryEnabled(): boolean {
  return process.env.AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED === "true";
}

export function isAiV5LocalizedOwnerUiEnabled(): boolean {
  return process.env.AI_V5_LOCALIZED_OWNER_UI_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED === "true";
}

export function isAiV5CustomerLocaleResolutionEnabled(): boolean {
  return process.env.AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED === "true";
}

export function isAiV5DealLanguageSwitchEnabled(): boolean {
  return process.env.AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED === "true" || process.env.EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED === "true";
}

export function isDebugPanelEnabled(): boolean {
  if (__DEV__) return true;
  return process.env.EXPO_PUBLIC_SHOW_DEBUG_PANEL === "true";
}

export function isDebugBootLogEnabled(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_DEBUG_BOOT_LOG === "true";
}
