import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AD_LOCALIZATION_JSON_SCHEMA,
  AD_LOCALIZATION_PROMPT_VERSION,
  adLocalizationOfferFactsFromDefinition,
  buildAdLocalizationPrompt,
  generateAdLocalizationTranscreations,
  type AdLocalizationProviderRequest,
} from "./ai-localization-provider.ts";
import { resolveAiTextProviderConfig } from "./ai-text-provider.ts";

function env(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

const providerEnv = env({
  AI_V3_PROVIDER_ROUTER_ENABLED: "true",
  AI_TEXT_PRIMARY_PROVIDER: "openai",
  AI_TEXT_FALLBACK_ENABLED: "false",
  OPENAI_MODEL: "gpt-5.5",
  GEMINI_TEXT_MODEL: "gemini-3.5-flash",
});

function openAiSuccess(value: unknown) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl_localization_test",
      choices: [
        {
          message: {
            content: JSON.stringify(value),
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req_localization" } },
  );
}

function request(overrides: Partial<AdLocalizationProviderRequest> = {}): AdLocalizationProviderRequest {
  return {
    adVersionId: "ad_version_123",
    sourceLocale: "en-US",
    targetLocales: ["en-US", "es-US", "ko-KR"],
    sourceCreative: {
      strategy: "customer_moment",
      headline: "Cedar Bean latte reward",
      supportingCopy: "Your afternoon latte comes with a cookie.",
      imageAltText: "Cedar Bean latte and cookie",
    },
    creativeBrief: {
      targetCustomerMoment: "Afternoon coffee break",
      exactCustomerHook: "A latte earns a cookie",
      desiredFeeling: "A small useful treat",
      naturalLanguageDirection: "Plainspoken local cafe copy",
    },
    offerFacts: adLocalizationOfferFactsFromDefinition({
      merchantName: "Cedar Bean",
      locationName: "Cedar Bean - Irving",
      offerType: "buy_one_get_reward_item",
      qualifyingItems: [{ displayName: "latte", quantity: 1 }],
      reward: {
        rule: "reward_item_free",
        displayNames: ["cookie"],
        quantity: 1,
        discountPercent: 100,
      },
      schedule: { summary: "Today 2:00 PM to 4:00 PM" },
      totalClaimLimit: 20,
      redemption: { redeemAtLocationName: "Cedar Bean - Irving" },
    }),
    protectedTerms: ["Cedar Bean", "latte", "cookie"],
    localizedTerms: [],
    merchantProfile: {
      normalizedCategory: "cafe",
      naturalCustomerLanguage: ["coffee break"],
      prohibitedClaims: ["ratings", "guarantees"],
    },
    generationRunId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildAdLocalizationPrompt", () => {
  it("requests target persuasive fields only and excludes the source locale", () => {
    const prompt = buildAdLocalizationPrompt(request());

    expect(prompt.targetLocales).toEqual(["es-US", "ko-KR"]);
    expect(prompt.systemPrompt).toContain(AD_LOCALIZATION_PROMPT_VERSION);
    expect(prompt.systemPrompt).toContain("must not author exact offer lines");
    expect(prompt.userPrompt).toContain("Target locales: es-US");
    expect(prompt.userPrompt).not.toContain("Target locales: en-US");

    const schemaText = JSON.stringify(AD_LOCALIZATION_JSON_SCHEMA);
    expect(schemaText).toContain("headline");
    expect(schemaText).toContain("supportingCopy");
    expect(schemaText).toContain("imageAltText");
    expect(schemaText).not.toContain("cta");
    expect(schemaText).not.toContain("push");
    expect(schemaText).not.toContain("terms");
    expect(schemaText).not.toContain("exactOfferLine");
    expect(schemaText).not.toContain("price");
  });
});

describe("generateAdLocalizationTranscreations", () => {
  it("uses the shared structured provider router and normalizes target locales", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiSuccess({
      localizations: [
        {
          locale: "en-US",
          headline: "Should be ignored",
          supportingCopy: "Source locale should not be accepted.",
          imageAltText: "Source locale ignored",
        },
        {
          locale: "es-US",
          headline: "Cedar Bean: latte con cookie gratis",
          supportingCopy: "Tu latte de la tarde viene con una cookie.",
          imageAltText: "Latte y cookie en Cedar Bean",
        },
        {
          locale: "ko-KR",
          headline: "Cedar Bean 라떼 혜택",
          supportingCopy: "오후 latte에 cookie가 함께 제공됩니다.",
          imageAltText: "Cedar Bean latte와 cookie",
        },
      ],
    }));

    const result = await generateAdLocalizationTranscreations(request(), {
      openAiApiKey: "openai-test-key",
      env: providerEnv,
      config: resolveAiTextProviderConfig(providerEnv),
    });

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-5.5");
    expect(result.promptVersion).toBe(AD_LOCALIZATION_PROMPT_VERSION);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.operation).toBe("translation");
    expect(result.targetCreatives["en-US"]).toBeUndefined();
    expect(result.targetCreatives["es-US"]?.headline).toBe("Cedar Bean: latte con cookie gratis");
    expect(result.targetCreatives["ko-KR"]?.headline).toBe("Cedar Bean 라떼 혜택");

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("ad_persuasive_transcreation");
    expect(body.response_format.json_schema.schema.properties.localizations.items.properties).toEqual({
      locale: { type: "string", enum: ["en-US", "es-US", "ko-KR"] },
      headline: { type: "string" },
      supportingCopy: { type: "string" },
      imageAltText: { type: "string" },
    });
    expect(JSON.stringify(body)).not.toContain("exactOfferLine");
  });

  it("returns no provider attempts when there are no target locales", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await generateAdLocalizationTranscreations(request({
      sourceLocale: "es-US",
      targetLocales: ["es-US"],
    }), {
      openAiApiKey: "openai-test-key",
      env: providerEnv,
      config: resolveAiTextProviderConfig(providerEnv),
    });

    expect(result).toMatchObject({
      provider: "none",
      model: "none",
      targetCreatives: {},
      attempts: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
