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
  isAiV4SharedRendererEnabled,
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

    expect(isAiV4ComposedAdCardEnabled()).toBe(false);
    expect(isAiV4SharedRendererEnabled()).toBe(false);
    expect(isAiV4AuthoritativeOfferCardEnabled()).toBe(false);
  });

  it("accepts public mobile aliases for client-side rollout", () => {
    process.env.EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED = "true";
    process.env.EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED = "true";

    expect(isAiV4ComposedAdCardEnabled()).toBe(true);
    expect(isAiV4SharedRendererEnabled()).toBe(true);
    expect(isAiV4AuthoritativeOfferCardEnabled()).toBe(true);
  });
});
