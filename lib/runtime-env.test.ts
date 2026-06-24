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

import { getPublicEnvSnapshot } from "./runtime-env";

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
