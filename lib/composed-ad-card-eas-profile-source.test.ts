import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type EasProfile = {
  env?: Record<string, string>;
};

type EasJson = {
  build: Record<string, EasProfile>;
};

const eas = JSON.parse(readFileSync(join(process.cwd(), "eas.json"), "utf8")) as EasJson;

const internalComposedFlags = [
  "EXPO_PUBLIC_AI_V4_COMPOSED_AD_CARD_ENABLED",
  "EXPO_PUBLIC_AI_V4_SHARED_RENDERER_ENABLED",
  "EXPO_PUBLIC_AI_V4_AUTHORITATIVE_OFFER_CARD_ENABLED",
  "EXPO_PUBLIC_AI_V4_PRESENTATION_RESOLVER_ENABLED",
  "EXPO_PUBLIC_AI_V4_MINIMAL_INPUT_FLOW_ENABLED",
  "EXPO_PUBLIC_AI_V4_INSTANT_STYLE_ALTERNATES_ENABLED",
  "EXPO_PUBLIC_AI_V4_COMPOSITE_QA_ENABLED",
  "EXPO_PUBLIC_AI_V4_EXACT_PRESENTATION_APPROVAL_ENABLED",
] as const;

describe("composed ad card EAS rollout profile guards", () => {
  it("enables composed-card internal QA flags only in non-production build profiles", () => {
    for (const profileName of ["development", "preview", "dev-client-apk"]) {
      const env = eas.build[profileName]?.env ?? {};
      for (const flag of internalComposedFlags) {
        expect(env[flag], `${profileName} ${flag}`).toBe("true");
      }
    }

    const productionEnv = eas.build.production?.env ?? {};
    for (const flag of internalComposedFlags) {
      expect(productionEnv[flag], `production ${flag}`).toBeUndefined();
    }
  });

  it("keeps screenshot QA disabled in EAS profiles until a screenshot runner exists", () => {
    for (const profile of Object.values(eas.build)) {
      expect(profile.env?.EXPO_PUBLIC_AI_V4_COMPOSITE_SCREENSHOT_QA_ENABLED).toBeUndefined();
    }
  });
});
