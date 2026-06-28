import { describe, expect, it } from "vitest";

import {
  buildSourceCreativePolicyPromptBlock,
  sourceCreativePolicyForAppLanguage,
} from "./ad-source-locale-policy";

describe("source creative locale policy", () => {
  it("maps app languages to product locales", () => {
    expect(sourceCreativePolicyForAppLanguage("en")).toMatchObject({
      locale: "en-US",
      languageName: "English",
    });
    expect(sourceCreativePolicyForAppLanguage("es")).toMatchObject({
      locale: "es-US",
      languageName: "U.S. Spanish",
    });
    expect(sourceCreativePolicyForAppLanguage("ko")).toMatchObject({
      locale: "ko-KR",
      languageName: "Korean",
    });
  });

  it("builds a protected-term source-language prompt block", () => {
    const block = buildSourceCreativePolicyPromptBlock({
      appLanguage: "es",
      protectedTerms: ["Cedar Bean", "Cedar Bean", "Nitro Latte"],
    });

    expect(block).toContain("Source locale: es-US");
    expect(block).toContain("Write all creativeBrief and candidate output fields in U.S. Spanish");
    expect(block).toContain("Preserve protected merchant names");
    expect(block).toContain("2x1");
    expect(block.match(/Cedar Bean/g)?.length).toBe(1);
    expect(block).toContain("Nitro Latte");
  });

  it("keeps Korean policy counter-safe", () => {
    const block = buildSourceCreativePolicyPromptBlock({
      appLanguage: "ko",
      protectedTerms: ["Cedar Bean"],
    });

    expect(block).toContain("Source locale: ko-KR");
    expect(block).toContain("Do not infer Korean counters");
    expect(block).toContain("1+1");
    expect(block).toContain("Cedar Bean");
  });
});
