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
  isAdJobAsyncStatusEnabled,
  isAiAdPipelineV3Enabled,
  isBusinessMediaLibraryEnabled,
  isBusinessSetupAutoWebsiteImportEnabled,
  isDeterministicAdTemplatesEnabled,
  isFacebookMediaImportEnabled,
  isInstagramMediaImportEnabled,
  isOfferDefinitionFallbackEnabled,
  isOfferVersionPublishEnabled,
  isPenguinDealLoaderEnabled,
  isStrictAiCopyStyleGateEnabled,
  isStrictNoPhotoGenerationInvariantEnabled,
  isThreeCreativeConceptsEnabled,
  isTwoferStockLibraryEnabled,
} from "./runtime-env";

describe("runtime-env offer definition fallback flag", () => {
  const previous = process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK;
  const previousPublish = process.env.EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH;
  const adFlagKeys = [
    "EXPO_PUBLIC_AI_AD_PIPELINE_V3",
    "EXPO_PUBLIC_BUSINESS_MEDIA_LIBRARY",
    "EXPO_PUBLIC_BUSINESS_SETUP_AUTO_WEBSITE_IMPORT",
    "EXPO_PUBLIC_INSTAGRAM_MEDIA_IMPORT",
    "EXPO_PUBLIC_FACEBOOK_MEDIA_IMPORT",
    "EXPO_PUBLIC_TWOFER_STOCK_LIBRARY",
    "EXPO_PUBLIC_STRICT_AI_COPY_STYLE_GATE",
    "EXPO_PUBLIC_THREE_CREATIVE_CONCEPTS",
    "EXPO_PUBLIC_DETERMINISTIC_AD_TEMPLATES",
    "EXPO_PUBLIC_PENGUIN_DEAL_LOADER",
    "EXPO_PUBLIC_AD_JOB_ASYNC_STATUS",
    "EXPO_PUBLIC_STRICT_NO_PHOTO_GENERATION_INVARIANT",
  ] as const;
  const previousAdFlags = Object.fromEntries(adFlagKeys.map((key) => [key, process.env[key]]));

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK;
    } else {
      process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK = previous;
    }
    if (previousPublish === undefined) {
      delete process.env.EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH;
    } else {
      process.env.EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH = previousPublish;
    }
    for (const key of adFlagKeys) {
      const previousValue = previousAdFlags[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  });

  it("only enables the fallback when the public flag is true", () => {
    process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK = "true";
    expect(isOfferDefinitionFallbackEnabled()).toBe(true);

    process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK = "false";
    expect(isOfferDefinitionFallbackEnabled()).toBe(false);

    delete process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK;
    expect(isOfferDefinitionFallbackEnabled()).toBe(false);
  });

  it("includes the fallback flag in the public diagnostics snapshot", () => {
    process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK = "true";
    process.env.EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH = "true";

    expect(getPublicEnvSnapshot().EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK).toBe("true");
    expect(getPublicEnvSnapshot().EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH).toBe("true");
  });

  it("only enables versioned publish when the public flag is true", () => {
    process.env.EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH = "true";
    expect(isOfferVersionPublishEnabled()).toBe(true);

    process.env.EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH = "false";
    expect(isOfferVersionPublishEnabled()).toBe(false);
  });

  it("keeps v3 ad rollout flags off unless each exact public flag is true", () => {
    const flagFns = [
      ["EXPO_PUBLIC_AI_AD_PIPELINE_V3", isAiAdPipelineV3Enabled],
      ["EXPO_PUBLIC_BUSINESS_MEDIA_LIBRARY", isBusinessMediaLibraryEnabled],
      ["EXPO_PUBLIC_BUSINESS_SETUP_AUTO_WEBSITE_IMPORT", isBusinessSetupAutoWebsiteImportEnabled],
      ["EXPO_PUBLIC_INSTAGRAM_MEDIA_IMPORT", isInstagramMediaImportEnabled],
      ["EXPO_PUBLIC_FACEBOOK_MEDIA_IMPORT", isFacebookMediaImportEnabled],
      ["EXPO_PUBLIC_TWOFER_STOCK_LIBRARY", isTwoferStockLibraryEnabled],
      ["EXPO_PUBLIC_STRICT_AI_COPY_STYLE_GATE", isStrictAiCopyStyleGateEnabled],
      ["EXPO_PUBLIC_THREE_CREATIVE_CONCEPTS", isThreeCreativeConceptsEnabled],
      ["EXPO_PUBLIC_DETERMINISTIC_AD_TEMPLATES", isDeterministicAdTemplatesEnabled],
      ["EXPO_PUBLIC_PENGUIN_DEAL_LOADER", isPenguinDealLoaderEnabled],
      ["EXPO_PUBLIC_AD_JOB_ASYNC_STATUS", isAdJobAsyncStatusEnabled],
      ["EXPO_PUBLIC_STRICT_NO_PHOTO_GENERATION_INVARIANT", isStrictNoPhotoGenerationInvariantEnabled],
    ] as const;

    for (const [key, fn] of flagFns) {
      delete process.env[key];
      expect(fn()).toBe(false);
      process.env[key] = "false";
      expect(fn()).toBe(false);
      process.env[key] = "TRUE";
      expect(fn()).toBe(false);
      process.env[key] = "true";
      expect(fn()).toBe(true);
    }
  });

  it("includes v3 ad rollout flags in the public diagnostics snapshot", () => {
    process.env.EXPO_PUBLIC_AI_AD_PIPELINE_V3 = "true";
    process.env.EXPO_PUBLIC_BUSINESS_MEDIA_LIBRARY = "false";
    process.env.EXPO_PUBLIC_STRICT_NO_PHOTO_GENERATION_INVARIANT = "true";

    const snapshot = getPublicEnvSnapshot();
    expect(snapshot.EXPO_PUBLIC_AI_AD_PIPELINE_V3).toBe("true");
    expect(snapshot.EXPO_PUBLIC_BUSINESS_MEDIA_LIBRARY).toBe("false");
    expect(snapshot.EXPO_PUBLIC_STRICT_NO_PHOTO_GENERATION_INVARIANT).toBe("true");
    expect(snapshot.EXPO_PUBLIC_INSTAGRAM_MEDIA_IMPORT).toBe("(unset)");
  });
});
