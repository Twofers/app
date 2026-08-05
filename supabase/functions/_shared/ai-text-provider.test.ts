import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateStructuredText,
  resolveAiTextProviderConfig,
} from "./ai-text-provider.ts";
import { generateOpenAiStructuredJson } from "./openai-text-provider.ts";

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

function openAiResponsesSuccess(
  value: unknown = { variants: [{ headlineAlternative: "Buy a latte, get one free" }] },
  usageOverrides: Record<string, unknown> = {},
) {
  return new Response(
    JSON.stringify({
      id: "resp_test",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
      usage: {
        input_tokens: 120,
        output_tokens: 60,
        input_tokens_details: { cached_tokens: 15 },
        output_tokens_details: { reasoning_tokens: 40 },
        ...usageOverrides,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req_responses_success" } },
  );
}

function openAiResponsesIncomplete(reason = "max_output_tokens") {
  return new Response(
    JSON.stringify({
      id: "resp_incomplete",
      status: "incomplete",
      incomplete_details: { reason },
      output: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const baseEnv = {
  AI_V3_PROVIDER_ROUTER_ENABLED: "true",
  AI_TEXT_PRIMARY_PROVIDER: "openai",
  AI_TEXT_FALLBACK_ENABLED: "true",
  AI_TEXT_FALLBACK_PROVIDER: "gemini",
  OPENAI_MODEL: "gpt-5.4-mini",
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
const routerSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "ai-text-provider.ts"),
  "utf8",
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveAiTextProviderConfig", () => {
  it("resolves separate OpenAI and Gemini text models", () => {
    const config = resolveAiTextProviderConfig(env(baseEnv));

    expect(config.openAiModel).toBe("gpt-5.4-mini");
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
    expect(routerSource).toMatch(/request failed before a typed provider error was returned/);
    expect(routerSource).toMatch(/AI provider router failed before a typed provider error was returned/);
    expect(routerSource).not.toMatch(/message:\s*String\(error\)/);
  });

  it("never reads request.temperature on the OpenAI path (gpt-5 family rejects a non-default temperature)", () => {
    expect(openAiProviderSource).not.toMatch(/request\.temperature/);
  });
});

function openAiEmptyContent(finishReason?: string) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          ...(finishReason ? { finish_reason: finishReason } : {}),
          message: { content: "" },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("provider_output_invalid retry flag (AI_RETRY_OUTPUT_INVALID_ENABLED)", () => {
  it("does not retry when the flag is unset (default = current behavior)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiEmptyContent());
    const noFallbackEnv = env({ ...baseEnv, AI_TEXT_FALLBACK_ENABLED: "false" });

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

    expect(caught).toMatchObject({ errorClass: "provider_output_invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the flag is explicitly false", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiEmptyContent());
    const flagOffEnv = env({ ...baseEnv, AI_TEXT_FALLBACK_ENABLED: "false", AI_RETRY_OUTPUT_INVALID_ENABLED: "false" });

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
        env: flagOffEnv,
        config: resolveAiTextProviderConfig(flagOffEnv),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ errorClass: "provider_output_invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once on the same provider when the flag is enabled, then succeeds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(openAiEmptyContent())
      .mockResolvedValueOnce(openAiSuccess());
    const retryEnv = env({ ...baseEnv, AI_TEXT_FALLBACK_ENABLED: "false", AI_RETRY_OUTPUT_INVALID_ENABLED: "true" });

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
      env: retryEnv,
      config: resolveAiTextProviderConfig(retryEnv),
    });

    expect(result.provider).toBe("openai");
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts[0]?.errorClass).toBe("provider_output_invalid");
  }, 10_000);

  it("still bounds the retry to the existing transientRetryMax ceiling of 1 (fails after 2 attempts)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(openAiEmptyContent())
      .mockResolvedValueOnce(openAiEmptyContent());
    const retryEnv = env({ ...baseEnv, AI_TEXT_FALLBACK_ENABLED: "false", AI_RETRY_OUTPUT_INVALID_ENABLED: "true" });

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
        env: retryEnv,
        config: resolveAiTextProviderConfig(retryEnv),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ errorClass: "provider_output_invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe("OpenAI finish_reason and reasoning_tokens diagnostics", () => {
  it("surfaces finish_reason=length in the thrown error's message and errorCode without changing errorClass", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiEmptyContent("length"));
    const noFallbackEnv = env({ ...baseEnv, AI_TEXT_FALLBACK_ENABLED: "false" });

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
      errorClass: "provider_output_invalid",
      errorCode: "OPENAI_EMPTY_CONTENT_TRUNCATED",
    });
    expect(String((caught as Error).message)).toMatch(/finish_reason=length/);
  });

  it("does not mark errors as truncated when finish_reason is absent/other", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiEmptyContent("stop"));
    const noFallbackEnv = env({ ...baseEnv, AI_TEXT_FALLBACK_ENABLED: "false" });

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

    expect(caught).toMatchObject({ errorClass: "provider_output_invalid", errorCode: "OPENAI_EMPTY_CONTENT" });
    expect(String((caught as Error).message)).not.toMatch(/finish_reason/);
  });

  it("captures OpenAI reasoning tokens from completion_tokens_details onto the attempt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ variants: [{ headlineAlternative: "x" }] }) } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 400,
            completion_tokens_details: { reasoning_tokens: 320 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

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

    expect(result.attempts[0]?.reasoningTokens).toBe(320);
    expect(result.attempts[0]?.outputTokens).toBe(400);
  });
});

describe("failed-attempt latency", () => {
  it("records real elapsed time for a failed attempt instead of ~0ms", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(
        JSON.stringify({ error: { code: "server_error_boom", message: "temporary provider failure" } }),
        { status: 500 },
      );
    });
    const noRetryEnv = env({ ...baseEnv, AI_TEXT_FALLBACK_ENABLED: "false", AI_TRANSIENT_RETRY_MAX: "0" });

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
        env: noRetryEnv,
        config: resolveAiTextProviderConfig(noRetryEnv),
      });
    } catch (error) {
      caught = error;
    }

    const attempts = (caught as { attempts?: Array<{ latencyMs: number; success: boolean }> }).attempts ?? [];
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.success).toBe(false);
    // Previously computed Date.now() inside the catch block (after the failed
    // call already completed), so this always logged ~0ms.
    expect(attempts[0]?.latencyMs).toBeGreaterThanOrEqual(30);
  });
});

describe("AI_GEMINI_QA_TEMPERATURE (Gemini-only, QA operations only)", () => {
  const qaRequest = (operation: "candidate_judge" | "image_qa" | "translation_qa" | "creative_candidates") => ({
    operation,
    systemPrompt: "System rules.",
    userPrompt: "Offer facts.",
    jsonSchema: schema,
    maxOutputTokens: 650,
    timeoutMs: 12000,
    generationRunId: "11111111-1111-4111-8111-111111111111",
    promptVersion: "test",
    reasoningLevel: "medium" as const,
  });

  it("sends no temperature field when the env var is unset (default, identical to today)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiSuccess());
    const geminiEnv = env({
      ...baseEnv,
      AI_TEXT_PRIMARY_PROVIDER: "gemini",
      AI_TEXT_FALLBACK_ENABLED: "false",
    });

    await generateStructuredText(qaRequest("candidate_judge"), {
      openAiApiKey: "openai-test-key",
      geminiApiKey: "gemini-test-key",
      env: geminiEnv,
      config: resolveAiTextProviderConfig(geminiEnv),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.generationConfig).not.toHaveProperty("temperature");
  });

  it("sets temperature on Gemini requests for candidate_judge/image_qa/translation_qa when the env var is set", async () => {
    for (const operation of ["candidate_judge", "image_qa", "translation_qa"] as const) {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiSuccess());
      const geminiEnv = env({
        ...baseEnv,
        AI_TEXT_PRIMARY_PROVIDER: "gemini",
        AI_TEXT_FALLBACK_ENABLED: "false",
        AI_GEMINI_QA_TEMPERATURE: "0.15",
      });

      await generateStructuredText(qaRequest(operation), {
        openAiApiKey: "openai-test-key",
        geminiApiKey: "gemini-test-key",
        env: geminiEnv,
        config: resolveAiTextProviderConfig(geminiEnv),
      });

      const [, init] = fetchMock.mock.calls[0] ?? [];
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body.generationConfig.temperature).toBe(0.15);
      fetchMock.mockRestore();
    }
  });

  it("does not set temperature for non-QA operations even when the env var is set", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiSuccess());
    const geminiEnv = env({
      ...baseEnv,
      AI_TEXT_PRIMARY_PROVIDER: "gemini",
      AI_TEXT_FALLBACK_ENABLED: "false",
      AI_GEMINI_QA_TEMPERATURE: "0.15",
    });

    await generateStructuredText(qaRequest("creative_candidates"), {
      openAiApiKey: "openai-test-key",
      geminiApiKey: "gemini-test-key",
      env: geminiEnv,
      config: resolveAiTextProviderConfig(geminiEnv),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.generationConfig).not.toHaveProperty("temperature");
  });

  it("never sends a temperature field to OpenAI even when the env var is set for a QA operation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiSuccess());
    const openAiEnv = env({
      ...baseEnv,
      AI_TEXT_FALLBACK_ENABLED: "false",
      AI_GEMINI_QA_TEMPERATURE: "0.15",
    });

    await generateStructuredText(qaRequest("candidate_judge"), {
      openAiApiKey: "openai-test-key",
      geminiApiKey: "gemini-test-key",
      env: openAiEnv,
      config: resolveAiTextProviderConfig(openAiEnv),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).not.toHaveProperty("temperature");
  });
});

describe("generateOpenAiStructuredJson: Responses API opt-in (AI_OPENAI_RESPONSES_API_ENABLED)", () => {
  const baseRequest = {
    operation: "creative_candidates" as const,
    systemPrompt: "System rules.",
    userPrompt: "Offer facts.",
    jsonSchema: schema,
    maxOutputTokens: 650,
    timeoutMs: 12000,
    generationRunId: "11111111-1111-4111-8111-111111111111",
    promptVersion: "test",
    reasoningLevel: "medium" as const,
  };

  it("flag off: gpt-5.5 still posts to /v1/chat/completions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiSuccess());

    await generateOpenAiStructuredJson({
      apiKey: "openai-test-key",
      model: "gpt-5.5",
      request: baseRequest,
      env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "false" }),
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("defaults to disabled when the env var is unset at all (byte-identical current behavior)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiSuccess());

    // No `env` override passed — exercises the production Deno.env fallback,
    // which resolves to null under node/vitest and so must default to off.
    await generateOpenAiStructuredJson({
      apiKey: "openai-test-key",
      model: "gpt-5.5",
      request: baseRequest,
    });

    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("flag on + gpt-5.5: posts to /v1/responses with json_schema format + reasoning effort", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiResponsesSuccess());

    const result = await generateOpenAiStructuredJson({
      apiKey: "openai-test-key",
      model: "gpt-5.5",
      request: baseRequest,
      env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.model).toBe("gpt-5.5");
    expect(body.instructions).toBe("System rules.");
    expect(body.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Offer facts." }] },
    ]);
    expect(body.text.format).toMatchObject({ type: "json_schema", name: "deal_copy", strict: true });
    expect(body.reasoning).toEqual({ effort: "medium" });
    // 650 caller budget + 2048 medium-effort reasoning reserve (chatCompletionTuning).
    expect(body.max_output_tokens).toBe(650 + 2048);
    expect(result.value).toEqual({ variants: [{ headlineAlternative: "Buy a latte, get one free" }] });
  });

  it("flag on + gpt-4o-mini: still uses chat.completions (Responses API is gpt-5-family only)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiSuccess());

    const result = await generateOpenAiStructuredJson({
      apiKey: "openai-test-key",
      model: "gpt-4o-mini",
      request: baseRequest,
      env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.messages).toBeDefined();
    expect(result.value).toEqual({ variants: [{ headlineAlternative: "Buy a latte, get one free" }] });
  });

  it("maps image inputs to input_image content parts on the Responses API path", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiResponsesSuccess());

    await generateOpenAiStructuredJson({
      apiKey: "openai-test-key",
      model: "gpt-5.5",
      request: {
        ...baseRequest,
        imageInputs: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }],
      },
      env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.input[0].content).toEqual([
      { type: "input_text", text: "Offer facts." },
      { type: "input_image", image_url: "data:image/jpeg;base64,AQID", detail: "high" },
    ]);
  });

  it("status 'incomplete' with reason 'max_output_tokens' throws provider_output_invalid / OPENAI_RESPONSES_TRUNCATED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiResponsesIncomplete());

    let caught: unknown;
    try {
      await generateOpenAiStructuredJson({
        apiKey: "openai-test-key",
        model: "gpt-5.5",
        request: baseRequest,
        env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      errorClass: "provider_output_invalid",
      errorCode: "OPENAI_RESPONSES_TRUNCATED",
    });
    expect(String((caught as Error).message)).toMatch(/max_output_tokens/);
  });

  it("does not mark other incomplete reasons as OPENAI_RESPONSES_TRUNCATED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiResponsesIncomplete("content_filter"));

    let caught: unknown;
    try {
      await generateOpenAiStructuredJson({
        apiKey: "openai-test-key",
        model: "gpt-5.5",
        request: baseRequest,
        env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ errorClass: "provider_output_invalid", errorCode: "OPENAI_EMPTY_CONTENT" });
  });

  it("missing/empty output text throws OPENAI_EMPTY_CONTENT", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "resp_empty", status: "completed", output: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    let caught: unknown;
    try {
      await generateOpenAiStructuredJson({
        apiKey: "openai-test-key",
        model: "gpt-5.5",
        request: baseRequest,
        env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ errorClass: "provider_output_invalid", errorCode: "OPENAI_EMPTY_CONTENT" });
  });

  it("JSON parse failure throws OPENAI_JSON_PARSE_FAILED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "resp_bad_json",
          status: "completed",
          output: [{ type: "message", content: [{ type: "output_text", text: "{not valid json" }] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    let caught: unknown;
    try {
      await generateOpenAiStructuredJson({
        apiKey: "openai-test-key",
        model: "gpt-5.5",
        request: baseRequest,
        env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ errorClass: "provider_output_invalid", errorCode: "OPENAI_JSON_PARSE_FAILED" });
  });

  it("reads output_text convenience field when present instead of walking output[]", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "resp_convenience",
          status: "completed",
          output_text: JSON.stringify({ variants: [{ headlineAlternative: "Convenience field wins" }] }),
          output: [],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await generateOpenAiStructuredJson({
      apiKey: "openai-test-key",
      model: "gpt-5.5",
      request: baseRequest,
      env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
    });

    expect(result.value).toEqual({ variants: [{ headlineAlternative: "Convenience field wins" }] });
  });

  it("normalizes usage from the Responses API shape (reasoning + cached tokens) onto the attempt", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(openAiResponsesSuccess());

    const result = await generateOpenAiStructuredJson({
      apiKey: "openai-test-key",
      model: "gpt-5.5",
      request: baseRequest,
      env: env({ AI_OPENAI_RESPONSES_API_ENABLED: "true" }),
    });

    expect(result.attempt.inputTokens).toBe(120);
    expect(result.attempt.outputTokens).toBe(60);
    expect(result.attempt.cachedInputTokens).toBe(15);
    expect(result.attempt.reasoningTokens).toBe(40);
  });
});
