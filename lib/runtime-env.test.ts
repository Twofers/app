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
  isOfferDefinitionFallbackEnabled,
  isOfferVersionPublishEnabled,
} from "./runtime-env";

describe("runtime-env offer definition fallback flag", () => {
  const previous = process.env.EXPO_PUBLIC_ENABLE_OFFER_DEFINITION_FALLBACK;
  const previousPublish = process.env.EXPO_PUBLIC_ENABLE_OFFER_VERSION_PUBLISH;

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
});
