import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateStructuredText,
  resolveAiTextProviderConfig,
} from "./ai-text-provider.ts";

function env(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

const schema = {
  name: "deal_copy",
  strict: true,
  schema: {
    type: "object",
    properties: {
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            headlineAlternative: { type: "string" },
          },
          required: ["headlineAlternative"],
          additionalProperties: false,
        },
      },
    },
    required: ["variants"],
    additionalProperties: false,
  },
};

function geminiSuccess(value = { variants: [{ headlineAlternative: "Buy a latte, get one free" }] }) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(value) }],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        cachedContentTokenCount: 20,
        candidatesTokenCount: 40,
        thoughtsTokenCount: 12,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const baseEnv = {
  AI_V3_PROVIDER_ROUTER_ENABLED: "true",
  AI_TEXT_PRIMARY_PROVIDER: "openai",
  AI_TEXT_FALLBACK_ENABLED: "true",
  AI_TEXT_FALLBACK_PROVIDER: "gemini",
  OPENAI_MODEL: "gpt-5.5",
  GEMINI_TEXT_MODEL: "gemini-3.5-flash",
  AI_TEXT_PRIMARY_TIMEOUT_MS: "12000",
  AI_TEXT_FALLBACK_TIMEOUT_MS: "14000",
  AI_TRANSIENT_RETRY_MAX: "1",
  AI_RETRY_AFTER_FULL_TIMEOUT: "false",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAiTextProviderConfig", () => {
  it("resolves separate OpenAI and Gemini text models", () => {
    const config = resolveAiTextProviderConfig(env(baseEnv));

    expect(config.openAiModel).toBe("gpt-5.5");
    expect(config.geminiTextModel).toBe("gemini-3.5-flash");
    expect(config.fallbackEnabled).toBe(true);
  });

  it("does not reuse the Gemini image model as text fallback", () => {
    const config = resolveAiTextProviderConfig(
      env({
        ...baseEnv,
        GEMINI_TEXT_MODEL: undefined,
        GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image",
      }),
    );

    expect(config.geminiTextModel).toBe("gemini-3.5-flash");
  });
});

describe("generateStructuredText", () => {
  it("falls back to Gemini immediately on OpenAI quota failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "insufficient_quota", message: "Quota exceeded." } }),
          { status: 429, headers: { "x-request-id": "req_quota" } },
        ),
      )
      .mockResolvedValueOnce(geminiSuccess());

    const result = await generateStructuredText({
      operation: "creative_candidates",
      systemPrompt: "System rules.",
      userPrompt: "Offer facts.",
      jsonSchema: schema,
      maxOutputTokens: 650,
      timeoutMs: 12000,
      generationRunId: "11111111-1111-4111-8111-111111111111",
      promptVersion: "test",
      reasoningLevel: "medium",
    }, {
      openAiApiKey: "openai-test-key",
      geminiApiKey: "gemini-test-key",
      env: env(baseEnv),
      config: resolveAiTextProviderConfig(env(baseEnv)),
    });

    expect(result.provider).toBe("gemini");
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toBe("quota_exhausted");
    expect(result.attempts.map((attempt) => attempt.provider)).toEqual(["openai", "gemini"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, geminiInit] = fetchMock.mock.calls[1] ?? [];
    const geminiBody = JSON.parse(String((geminiInit as RequestInit).body));
    expect(geminiBody.generationConfig.responseMimeType).toBe("application/json");
    expect(geminiBody.generationConfig.thinkingConfig.thinkingLevel).toBe("medium");
    expect(geminiBody.generationConfig.responseSchema.additionalProperties).toBeUndefined();
  });

  it("does not retry OpenAI after a full timeout before falling back", async () => {
    const timeout = new DOMException("The operation timed out.", "TimeoutError");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(geminiSuccess());

    const result = await generateStructuredText({
      operation: "creative_candidates",
      systemPrompt: "System rules.",
      userPrompt: "Offer facts.",
      jsonSchema: schema,
      maxOutputTokens: 650,
      timeoutMs: 12000,
      generationRunId: "11111111-1111-4111-8111-111111111111",
      promptVersion: "test",
      reasoningLevel: "medium",
    }, {
      openAiApiKey: "openai-test-key",
      geminiApiKey: "gemini-test-key",
      env: env(baseEnv),
      config: resolveAiTextProviderConfig(env(baseEnv)),
    });

    expect(result.provider).toBe("gemini");
    expect(result.fallbackReason).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

