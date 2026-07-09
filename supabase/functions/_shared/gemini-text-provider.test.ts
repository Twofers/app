import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { geminiMaxOutputTokens, geminiResponseSchema } from "./gemini-text-provider.ts";

describe("geminiMaxOutputTokens", () => {
  it("adds a thinking reserve on top of the caller's visible-output budget", () => {
    // Gemini counts thought tokens against maxOutputTokens; without the reserve
    // a medium-thinking call (e.g. translation_qa at 850 tokens) truncated its
    // JSON payload -> GEMINI_JSON_PARSE_FAILED (K-001).
    expect(geminiMaxOutputTokens(850, "medium")).toBe(850 + 4096);
    expect(geminiMaxOutputTokens(850, "low")).toBe(850 + 1024);
    expect(geminiMaxOutputTokens(850, "high")).toBe(850 + 8192);
    expect(geminiMaxOutputTokens(850, "minimal")).toBe(850 + 256);
  });

  it("falls back to the medium reserve for unknown levels and floors tiny budgets", () => {
    expect(geminiMaxOutputTokens(850, "unexpected")).toBe(850 + 4096);
    expect(geminiMaxOutputTokens(0, "minimal")).toBe(256 + 256);
  });
});

describe("geminiResponseSchema", () => {
  it("keeps a `name` PROPERTY (only the OpenAI wrapper's root name/strict are stripped)", () => {
    // Regression for site_import INVALID_ARGUMENT: a menu item schema has a
    // `name` field. The old recursive strip deleted it while leaving `name` in
    // `required`, so Gemini rejected the whole request.
    const openAiWrapped = {
      name: "menu_extraction", // wrapper field — should NOT survive
      strict: true, // wrapper field — should NOT survive
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" }, // FIELD — must survive
                price_text: { type: "string" },
              },
              required: ["name", "price_text"],
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    };
    const out = geminiResponseSchema(openAiWrapped) as Record<string, unknown>;
    // Root is the unwrapped schema — no wrapper name/strict, no additionalProperties.
    expect(out.name).toBeUndefined();
    expect(out.strict).toBeUndefined();
    expect(out.additionalProperties).toBeUndefined();
    const itemProps = (out as any).properties.items.items.properties;
    const itemReq = (out as any).properties.items.items.required as string[];
    // The `name` FIELD is preserved and still declared in `required`.
    expect(itemProps.name).toEqual({ type: "string" });
    expect(itemReq).toContain("name");
    // additionalProperties is stripped at every depth.
    expect((out as any).properties.items.items.additionalProperties).toBeUndefined();
    // Every required entry has a matching property (the invariant Gemini enforces).
    for (const key of itemReq) expect(itemProps[key]).toBeDefined();
  });
});

describe("gemini structured generation source", () => {
  const source = readFileSync(
    join(__dirname, "gemini-text-provider.ts"),
    "utf8",
  );

  it("applies the thinking reserve to the request's generationConfig", () => {
    expect(source).toMatch(/maxOutputTokens:\s*geminiMaxOutputTokens\(/);
  });

  it("flags MAX_TOKENS truncation in empty/invalid JSON errors", () => {
    expect(source).toContain('geminiFinishReason(json) === "MAX_TOKENS"');
    expect(source).toContain("output token budget exhausted");
  });
});
