import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AD_LOCALIZATION_JSON_SCHEMA,
  AD_LOCALIZATION_PROMPT_VERSION,
  AD_LOCALIZATION_REPAIR_PROMPT_VERSION,
  adLocalizationOfferFactsFromDefinition,
  buildAdLocalizationPrompt,
  buildAdLocalizationRepairPrompt,
  generateAdLocalizationTranscreations,
  generateVerifiedAdLocalizationBundle,
  repairAdLocalizationTranscreation,
  type AdLocalizationProviderRequest,
  type AdLocalizationRepairRequest,
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

function repairRequest(overrides: Partial<AdLocalizationRepairRequest> = {}): AdLocalizationRepairRequest {
  const base = request();
  return {
    ...base,
    targetLocale: "es-US",
    failedCreative: {
      headline: "Cedar Bean 2x1 en latte",
      supportingCopy: "Tu latte viene con una cookie.",
      imageAltText: "Latte y cookie en Cedar Bean",
    },
    reasonCodes: ["BANNED_SHORTHAND"],
    conciseFeedback: ["Target fields use banned BOGO shorthand."],
    failedFields: ["headline"],
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

describe("buildAdLocalizationRepairPrompt", () => {
  it("targets one failed locale and carries QA feedback without passing locales", () => {
    const prompt = buildAdLocalizationRepairPrompt(repairRequest());

    expect(prompt.repairable).toBe(true);
    expect(prompt.systemPrompt).toContain(AD_LOCALIZATION_REPAIR_PROMPT_VERSION);
    expect(prompt.systemPrompt).toContain("Repair only the requested target locale");
    expect(prompt.userPrompt).toContain("Repair target locale: es-US");
    expect(prompt.userPrompt).toContain("BANNED_SHORTHAND");
    expect(prompt.userPrompt).toContain("Target fields use banned BOGO shorthand.");
    expect(prompt.userPrompt).toContain("Cedar Bean 2x1 en latte");
    expect(prompt.userPrompt).not.toContain("Repair target locale: ko-KR");
    expect(JSON.stringify(prompt.jsonSchema)).not.toContain("localizations");
  });

  it("marks fact drift and unsupported claims as non-repairable", () => {
    const prompt = buildAdLocalizationRepairPrompt(repairRequest({
      reasonCodes: ["OFFER_FACT_DRIFT"],
    }));

    expect(prompt).toMatchObject({
      repairable: false,
      skippedReason: "NON_REPAIRABLE_QA_FAILURE",
    });
    expect(prompt.systemPrompt).toBe("");
    expect(prompt.userPrompt).toBe("");
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

describe("repairAdLocalizationTranscreation", () => {
  it("uses the shared router for one target locale repair", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiSuccess({
      localization: {
        locale: "es-US",
        headline: "Cedar Bean: latte con cookie gratis",
        supportingCopy: "Tu latte de la tarde viene con una cookie.",
        imageAltText: "Latte y cookie en Cedar Bean",
      },
    }));

    const result = await repairAdLocalizationTranscreation(repairRequest(), {
      openAiApiKey: "openai-test-key",
      env: providerEnv,
      config: resolveAiTextProviderConfig(providerEnv),
    });

    expect(result.provider).toBe("openai");
    expect(result.promptVersion).toBe(AD_LOCALIZATION_REPAIR_PROMPT_VERSION);
    expect(result.attempts[0]?.operation).toBe("translation");
    expect(result.targetCreatives["es-US"]?.headline).toBe("Cedar Bean: latte con cookie gratis");
    expect(result.targetCreatives["ko-KR"]).toBeUndefined();

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.response_format.json_schema.name).toBe("ad_persuasive_transcreation_repair");
    expect(body.response_format.json_schema.schema.properties.localization.required).toEqual([
      "locale",
      "headline",
      "supportingCopy",
      "imageAltText",
    ]);
    expect(JSON.stringify(body)).not.toContain("exactOfferLine");
  });

  it("does not call a provider for non-repairable QA failures", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await repairAdLocalizationTranscreation(repairRequest({
      reasonCodes: ["UNSUPPORTED_CLAIM"],
    }), {
      openAiApiKey: "openai-test-key",
      env: providerEnv,
      config: resolveAiTextProviderConfig(providerEnv),
    });

    expect(result).toMatchObject({
      provider: "none",
      model: "none",
      skippedReason: "NON_REPAIRABLE_QA_FAILURE",
      targetCreatives: {},
      attempts: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("generateVerifiedAdLocalizationBundle", () => {
  it("repairs only the failed target locale before building the bundle", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(openAiSuccess({
        localizations: [
          {
            locale: "es-US",
            headline: "Cedar Bean 2x1 en latte",
            supportingCopy: "Tu latte de la tarde viene con una cookie.",
            imageAltText: "Latte y cookie en Cedar Bean",
          },
          {
            locale: "ko-KR",
            headline: "Cedar Bean \uB77C\uB5BC \uD61C\uD0DD",
            supportingCopy: "\uC624\uD6C4 latte\uC5D0 cookie\uAC00 \uD568\uAED8 \uC81C\uACF5\uB429\uB2C8\uB2E4.",
            imageAltText: "Cedar Bean latte\uC640 cookie",
          },
        ],
      }))
      .mockResolvedValueOnce(openAiSuccess({
        localization: {
          locale: "es-US",
          headline: "Cedar Bean: latte con cookie gratis",
          supportingCopy: "Tu latte de la tarde viene con una cookie.",
          imageAltText: "Latte y cookie en Cedar Bean",
        },
      }));

    const result = await generateVerifiedAdLocalizationBundle({
      request: request(),
      offerDefinition: {
        schemaVersion: 1,
        status: "draft",
        source: "deal_eligibility_v1",
        merchantId: "biz_123",
        merchantName: "Cedar Bean",
        locationId: "loc_123",
        locationName: "Cedar Bean - Irving",
        timeZone: "America/Chicago",
        offerType: "buy_one_get_reward_item",
        qualifyingItems: [{ catalogItemId: null, displayName: "latte", quantity: 1, verifiedAttributes: [] }],
        reward: {
          rule: "reward_item_free",
          discountPercent: 100,
          quantity: 1,
          catalogItemIds: [],
          displayNames: ["cookie"],
        },
        perUserClaimLimit: 1,
        totalClaimLimit: 20,
        schedule: {
          mode: "summary_only",
          summary: "Today 2:00 PM to 4:00 PM",
          startsAt: null,
          endsAt: null,
          timeZone: "America/Chicago",
          daysOfWeek: null,
          windowStartMinutes: null,
          windowEndMinutes: null,
        },
        redemption: {
          exactLocationOnly: true,
          redeemAtBusinessName: "Cedar Bean",
          redeemAtLocationName: "Cedar Bean - Irving",
          claimCutoffSummary: null,
        },
        fulfillmentModes: ["in_store"],
        stackable: false,
        sourceAssetIds: [],
        canonicalOfferLine: "Buy 1 latte and get 1 cookie free",
        canonicalOfferSentence: "Buy 1 latte and get 1 cookie free.",
        canonicalTermsLine: "Buy 1 latte and get 1 cookie free.",
        disclosureIds: ["canonical_offer_terms"],
        disclosureLine: "Buy 1 latte and get 1 cookie free. Limit one claim per customer.",
      },
      deps: {
        openAiApiKey: "openai-test-key",
        env: providerEnv,
        config: resolveAiTextProviderConfig(providerEnv),
      },
      providerEnabled: true,
      repairEnabled: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.repairTargetLocales).toEqual(["es-US"]);
    expect(result.deterministicQa["es-US"]?.decision).toBe("repair");
    expect(result.repairs["es-US"]?.promptVersion).toBe(AD_LOCALIZATION_REPAIR_PROMPT_VERSION);
    expect(result.repairs["ko-KR"]).toBeUndefined();
    expect(result.bundle.localizations["es-US"]).toMatchObject({
      headline: "Cedar Bean: latte con cookie gratis",
      translationStatus: "persuasive_transcreation",
      repairAttempted: true,
      repairStatus: "attempted_pass",
    });
    expect(result.bundle.localizations["ko-KR"]).toMatchObject({
      translationStatus: "persuasive_transcreation",
      repairAttempted: false,
      repairStatus: "not_needed",
    });
  });

  it("falls back deterministically when transcreation provider is disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await generateVerifiedAdLocalizationBundle({
      request: request(),
      offerDefinition: {
        schemaVersion: 1,
        status: "draft",
        source: "deal_eligibility_v1",
        merchantId: "biz_123",
        merchantName: "Cedar Bean",
        locationId: "loc_123",
        locationName: "Cedar Bean - Irving",
        timeZone: null,
        offerType: "buy_one_get_reward_item",
        qualifyingItems: [{ catalogItemId: null, displayName: "latte", quantity: 1, verifiedAttributes: [] }],
        reward: {
          rule: "reward_item_free",
          discountPercent: 100,
          quantity: 1,
          catalogItemIds: [],
          displayNames: ["cookie"],
        },
        perUserClaimLimit: 1,
        totalClaimLimit: 20,
        schedule: {
          mode: "summary_only",
          summary: "Today 2:00 PM to 4:00 PM",
          startsAt: null,
          endsAt: null,
          timeZone: null,
          daysOfWeek: null,
          windowStartMinutes: null,
          windowEndMinutes: null,
        },
        redemption: {
          exactLocationOnly: true,
          redeemAtBusinessName: "Cedar Bean",
          redeemAtLocationName: "Cedar Bean - Irving",
          claimCutoffSummary: null,
        },
        fulfillmentModes: ["in_store"],
        stackable: false,
        sourceAssetIds: [],
        canonicalOfferLine: "Buy 1 latte and get 1 cookie free",
        canonicalOfferSentence: "Buy 1 latte and get 1 cookie free.",
        canonicalTermsLine: "Buy 1 latte and get 1 cookie free.",
        disclosureIds: ["canonical_offer_terms"],
        disclosureLine: "Buy 1 latte and get 1 cookie free. Limit one claim per customer.",
      },
      deps: {
        openAiApiKey: "openai-test-key",
        env: providerEnv,
        config: resolveAiTextProviderConfig(providerEnv),
      },
      providerEnabled: false,
      repairEnabled: true,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.transcreation).toMatchObject({
      provider: "none",
      skippedReason: "TRANSCREATION_FLAG_DISABLED",
    });
    expect(result.repairTargetLocales).toEqual([]);
    expect(result.bundle.deterministicFallbackLocales).toEqual(["es-US", "ko-KR"]);
  });
});
