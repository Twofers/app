import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPENAI_MODEL,
  chatCompletionTuning,
  resolveOpenAiChatModel,
} from "./openai-chat-model.ts";

function env(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name];
    },
  };
}

describe("resolveOpenAiChatModel", () => {
  it("defaults production text generation to gpt-5.5", () => {
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.5");
    expect(resolveOpenAiChatModel(env({}))).toBe("gpt-5.5");
  });

  it("allows explicit override models", () => {
    expect(resolveOpenAiChatModel(env({ OPENAI_MODEL: "gpt-5.5" }))).toBe("gpt-5.5");
    expect(resolveOpenAiChatModel(env({ OPENAI_MODEL: "gpt-5.4-mini" }))).toBe("gpt-5.4-mini");
    expect(resolveOpenAiChatModel(env({ OPENAI_MODEL: "gpt-4o-mini" }))).toBe("gpt-4o-mini");
  });

  it("throws on unsupported model instead of silently downgrading", () => {
    expect(() => resolveOpenAiChatModel(env({ OPENAI_MODEL: "made-up-model" }))).toThrow(
      /AI_TEXT_CONFIG_INVALID/,
    );
  });
});

describe("chatCompletionTuning", () => {
  it("uses medium reasoning by default and reserves reasoning headroom for GPT-5 family models", () => {
    // Output budget (650) + medium reasoning reserve (2048).
    expect(chatCompletionTuning("gpt-5.4-mini", { maxTokens: 650 })).toMatchObject({
      max_completion_tokens: 2698,
      reasoning_effort: "medium",
    });
  });

  it("reserves reasoning headroom on top of the caller's output budget for the ad-copy call", () => {
    // Regression for OPENAI_EMPTY_CONTENT: the 5-variant ad copy call (1400 output
    // tokens, medium reasoning) previously capped at 1400 total and reasoning ate
    // the whole budget. It must now reserve reasoning room above the output budget.
    expect(chatCompletionTuning("gpt-5.4-mini", { maxTokens: 1400, reasoningEffort: "medium" })).toMatchObject({
      max_completion_tokens: 1400 + 2048,
      reasoning_effort: "medium",
    });
  });

  it("scales the reasoning reserve with effort", () => {
    expect(chatCompletionTuning("gpt-5.4-mini", { maxTokens: 220, reasoningEffort: "low" })).toMatchObject({
      // Output budget floored to 512 + low reserve (512).
      max_completion_tokens: 1024,
      reasoning_effort: "low",
    });
    expect(chatCompletionTuning("gpt-5.4-mini", { maxTokens: 220, reasoningEffort: "high" })).toMatchObject({
      max_completion_tokens: 512 + 4096,
      reasoning_effort: "high",
    });
  });

  it("keeps classic max_tokens shape for rollback chat models", () => {
    expect(chatCompletionTuning("gpt-4o-mini", { maxTokens: 650, temperature: 0.4 })).toEqual({
      max_tokens: 650,
      temperature: 0.4,
    });
  });
});
