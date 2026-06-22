import { readFileSync } from "node:fs";
import { join } from "node:path";
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

function openAiSuccess(value = { variants: [{ headlineAlternative: "Buy a latte, get one free" }] }) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl_test",
      choices: [
        {
          message: {
            content: JSON.stringify(value),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 140,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req_success" } },
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

const openAiProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "openai-text-provider.ts"),
  "utf8",
);
const geminiProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "gemini-text-provider.ts"),
  "utf8",
);

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

  it("sanitizes thrown OpenAI provider messages while preserving classification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "rate_limit_error",
            message: "quota exceeded raw provider secret body",
          },
        }),
        { status: 429, headers: { "x-request-id": "req_raw_message" } },
      ),
    );
    const noFallbackEnv = env({
      ...baseEnv,
      AI_TEXT_FALLBACK_ENABLED: "false",
    });

    let caught: unknown;
    try {
      await generateStructuredText({
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
        env: noFallbackEnv,
        config: resolveAiTextProviderConfig(noFallbackEnv),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      errorClass: "quota_exhausted",
      errorCode: "rate_limit_error",
      message: "OpenAI structured generation failed with rate_limit_error.",
    });
    expect(String((caught as Error).message)).not.toContain("raw provider secret body");
    const attempts = (caught as { attempts?: Array<{ errorCode?: string }> }).attempts ?? [];
    expect(attempts[0]?.errorCode).toBe("rate_limit_error");
  });

  it("sanitizes thrown Gemini provider messages while preserving classification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "RESOURCE_EXHAUSTED",
            message: "quota raw provider secret body",
          },
        }),
        { status: 429 },
      ),
    );
    const geminiEnv = env({
      ...baseEnv,
      AI_TEXT_PRIMARY_PROVIDER: "gemini",
      AI_TEXT_FALLBACK_ENABLED: "false",
    });

    let caught: unknown;
    try {
      await generateStructuredText({
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
        env: geminiEnv,
        config: resolveAiTextProviderConfig(geminiEnv),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      errorClass: "quota_exhausted",
      errorCode: "HTTP_429",
      message: "Gemini structured generation failed with HTTP_429.",
    });
    expect(String((caught as Error).message)).not.toContain("raw provider secret body");
    const attempts = (caught as { attempts?: Array<{ errorCode?: string }> }).attempts ?? [];
    expect(attempts[0]?.errorCode).toBe("HTTP_429");
  });

  it("sends image inputs as OpenAI multimodal content parts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiSuccess());

    const result = await generateStructuredText({
      operation: "creative_candidates",
      systemPrompt: "System rules.",
      userPrompt: "Offer facts from a photo.",
      imageInputs: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }],
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

    expect(result.provider).toBe("openai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "Offer facts from a photo." },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
    ]);
  });

  it("sends image inputs as Gemini inline data parts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiSuccess());
    const geminiEnv = env({
      ...baseEnv,
      AI_TEXT_PRIMARY_PROVIDER: "gemini",
      AI_TEXT_FALLBACK_ENABLED: "false",
    });

    const result = await generateStructuredText({
      operation: "creative_candidates",
      systemPrompt: "System rules.",
      userPrompt: "Offer facts from a photo.",
      imageInputs: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
      jsonSchema: schema,
      maxOutputTokens: 650,
      timeoutMs: 12000,
      generationRunId: "11111111-1111-4111-8111-111111111111",
      promptVersion: "test",
      reasoningLevel: "medium",
    }, {
      openAiApiKey: "openai-test-key",
      geminiApiKey: "gemini-test-key",
      env: geminiEnv,
      config: resolveAiTextProviderConfig(geminiEnv),
    });

    expect(result.provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.contents[0].parts).toEqual([
      { text: "Offer facts from a photo." },
      { inlineData: { mimeType: "image/png", data: "AQID" } },
    ]);
  });
});

describe("text provider source guards", () => {
  it("does not surface raw thrown exception text in provider errors", () => {
    expect(openAiProviderSource).toMatch(/OPENAI_FETCH_FAILED/);
    expect(openAiProviderSource).toMatch(/OpenAI structured generation failed before a usable response was returned/);
    expect(geminiProviderSource).toMatch(/GEMINI_FETCH_FAILED/);
    expect(geminiProviderSource).toMatch(/Gemini structured generation failed before a usable response was returned/);
    expect(openAiProviderSource).not.toMatch(/message:\s*String\(error\)\.slice/);
    expect(geminiProviderSource).not.toMatch(/message:\s*String\(error\)\.slice/);
  });
});
