import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: {
    executionEnvironment: "storeClient",
    expoConfig: {
      extra: {},
      version: "1.0.0",
    },
  },
}));

import {
  getPublicEnvSnapshot,
  isAiV4AuthoritativeOfferCardEnabled,
  isAiV4ComposedAdCardEnabled,
  isAiV4CompositeQaEnabled,
  isAiV4CompositeScreenshotQaEnabled,
  isAiV4ExactPresentationApprovalEnabled,
  isAiV4InstantStyleAlternatesEnabled,
  isAiV4MinimalInputFlowEnabled,
  isAiV4PresentationResolverEnabled,
  isAiV4SharedRendererEnabled,
  isAiV5CustomerLocaleResolutionEnabled,
  isAiV5DealLanguageSwitchEnabled,
  isAiV5KoreanCounterRegistryEnabled,
  isAiV5LocalizedOwnerUiEnabled,
  isAiV5LocalizedOfferRendererEnabled,
  isAiV5MultilingualFoundationEnabled,
} from "./runtime-env";

describe("runtime-env retired offer rollout flags", () => {
  const previous = process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK;
    } else {
      process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK = previous;
    }
  });

  it("does not expose the retired offer-definition fallback flag", () => {
    process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK = "true";

    expect(getPublicEnvSnapshot()).not.toHaveProperty("EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK");
  });
});

describe("runtime-env AI V4 composed card flags", () => {
  const previous = {
    AI_V4_COMPOSED_AD_CARD_ENABLED: process.env.AI_V4_COMPOSED_AD_CARD_ENABLED,
    EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED: process.env.EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED,
    AI_V4_SHARED_RENDERER_ENABLED: process.env.AI_V4_SHARED_RENDERER_ENABLED,
    EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED: process.env.EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED,
    AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED: process.env.AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED,
    EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED: process.env.EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED,
    AI_V4_PRESENTATION_RESOLVER_ENABLED: process.env.AI_V4_PRESENTATION_RESOLVER_ENABLED,
    EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED: process.env.EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED,
    AI_V4_MINIMAL_INPUT_FLOW_ENABLED: process.env.AI_V4_MINIMAL_INPUT_FLOW_ENABLED,
    EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED: process.env.EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED,
    AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED: process.env.AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED,
    EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED: process.env.EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED,
    AI_V4_COMPOSITE_QA_ENABLED: process.env.AI_V4_COMPOSITE_QA_ENABLED,
    EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED: process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED,
    AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED: process.env.AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED,
    EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED: process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED,
    AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED: process.env.AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED,
    EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED: process.env.EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED,
    AI_V5_MULTILINGUAL_FOUNDATION_ENABLED: process.env.AI_V5_MULTILINGUAL_FOUNDATION_ENABLED,
    EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED: process.env.EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED,
    AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED: process.env.AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED,
    EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED: process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED,
    AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED: process.env.AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED,
    EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED: process.env.EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED,
    AI_V5_LOCALIZED_OWNER_UI_ENABLED: process.env.AI_V5_LOCALIZED_OWNER_UI_ENABLED,
    EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED: process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED,
    AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED: process.env.AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED,
    EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED: process.env.EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED,
    AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED: process.env.AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED,
    EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED: process.env.EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("defaults the composed card rollout off", () => {
    delete process.env.AI_V4_COMPOSED_AD_CARD_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED;
    delete process.env.AI_V4_SHARED_RENDERER_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED;
    delete process.env.AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED;
    delete process.env.AI_V4_PRESENTATION_RESOLVER_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED;
    delete process.env.AI_V4_MINIMAL_INPUT_FLOW_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED;
    delete process.env.AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED;
    delete process.env.AI_V4_COMPOSITE_QA_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED;
    delete process.env.AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED;
    delete process.env.AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED;
    delete process.env.AI_V5_MULTILINGUAL_FOUNDATION_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED;
    delete process.env.AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED;
    delete process.env.AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED;
    delete process.env.AI_V5_LOCALIZED_OWNER_UI_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED;
    delete process.env.AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED;
    delete process.env.AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED;
    delete process.env.EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED;

    expect(isAiV4ComposedAdCardEnabled()).toBe(false);
    expect(isAiV4SharedRendererEnabled()).toBe(false);
    expect(isAiV4AuthoritativeOfferCardEnabled()).toBe(false);
    expect(isAiV4PresentationResolverEnabled()).toBe(false);
    expect(isAiV4MinimalInputFlowEnabled()).toBe(false);
    expect(isAiV4InstantStyleAlternatesEnabled()).toBe(false);
    expect(isAiV4CompositeQaEnabled()).toBe(false);
    expect(isAiV4CompositeScreenshotQaEnabled()).toBe(false);
    expect(isAiV4ExactPresentationApprovalEnabled()).toBe(false);
    expect(isAiV5MultilingualFoundationEnabled()).toBe(false);
    expect(isAiV5LocalizedOfferRendererEnabled()).toBe(false);
    expect(isAiV5KoreanCounterRegistryEnabled()).toBe(false);
    expect(isAiV5LocalizedOwnerUiEnabled()).toBe(false);
    expect(isAiV5CustomerLocaleResolutionEnabled()).toBe(false);
    expect(isAiV5DealLanguageSwitchEnabled()).toBe(false);
  });

  it("accepts public mobile aliases for client-side rollout", () => {
    process.env.EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V5_MULTILINGUAL_FOUNDATION_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V5_LOCALIZED_OWNER_UI_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED = "true";

    expect(isAiV4ComposedAdCardEnabled()).toBe(true);
    expect(isAiV4SharedRendererEnabled()).toBe(true);
    expect(isAiV4AuthoritativeOfferCardEnabled()).toBe(true);
    expect(isAiV4PresentationResolverEnabled()).toBe(true);
    expect(isAiV4MinimalInputFlowEnabled()).toBe(true);
    expect(isAiV4InstantStyleAlternatesEnabled()).toBe(true);
    expect(isAiV4CompositeQaEnabled()).toBe(true);
    expect(isAiV4CompositeScreenshotQaEnabled()).toBe(true);
    expect(isAiV4ExactPresentationApprovalEnabled()).toBe(true);
    expect(isAiV5MultilingualFoundationEnabled()).toBe(true);
    expect(isAiV5LocalizedOfferRendererEnabled()).toBe(true);
    expect(isAiV5KoreanCounterRegistryEnabled()).toBe(true);
    expect(isAiV5LocalizedOwnerUiEnabled()).toBe(true);
    expect(isAiV5CustomerLocaleResolutionEnabled()).toBe(true);
    expect(isAiV5DealLanguageSwitchEnabled()).toBe(true);
  });
});
