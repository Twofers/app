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

  it("allows explicit rollback models", () => {
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
  it("uses medium reasoning by default for GPT-5 family models", () => {
    expect(chatCompletionTuning("gpt-5.5", { maxTokens: 650 })).toMatchObject({
      max_completion_tokens: 1024,
      reasoning_effort: "medium",
    });
  });

  it("keeps classic max_tokens shape for rollback chat models", () => {
    expect(chatCompletionTuning("gpt-4o-mini", { maxTokens: 650, temperature: 0.4 })).toEqual({
      max_tokens: 650,
      temperature: 0.4,
    });
  });
});

