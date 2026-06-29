import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants candidate judge source guard", () => {
  it("sends all five validated strategy candidates to the independent judge", () => {
    const judgeStart = source.indexOf("const judgeCandidates = ranked");
    const shuffleStart = source.indexOf("const shuffled = seededShuffle", judgeStart);
    const requestStart = source.indexOf("const result = await generateStructuredText", shuffleStart);
    const requestEnd = source.indexOf("timeoutMs:", requestStart);
    const judgeBlock = source.slice(judgeStart, shuffleStart);
    const requestBlock = source.slice(requestStart, requestEnd);

    expect(judgeStart).toBeGreaterThan(-1);
    expect(shuffleStart).toBeGreaterThan(judgeStart);
    expect(requestStart).toBeGreaterThan(shuffleStart);
    expect(judgeBlock).toContain("validateAiCopyAgainstOffer(variant, params.offerContract).valid");
    expect(judgeBlock).toContain(".slice(0, 5)");
    expect(judgeBlock).not.toContain(".slice(0, 3)");
    expect(source).toContain("candidates: shuffled");
    expect(requestBlock).toContain("maxOutputTokens: 780");
  });

  it("returns and coerces up to five merchant copy alternatives", () => {
    const buildStart = source.indexOf("function buildCopyAlternatives(");
    const defaultCtaStart = source.indexOf("function defaultCta", buildStart);
    const coerceStart = source.indexOf("function coerceCopyAlternatives(");
    const coerceEnd = source.indexOf("function coerceSingleAd", coerceStart);
    const buildBlock = source.slice(buildStart, defaultCtaStart);
    const coerceBlock = source.slice(coerceStart, coerceEnd);

    expect(buildStart).toBeGreaterThan(-1);
    expect(defaultCtaStart).toBeGreaterThan(buildStart);
    expect(coerceStart).toBeGreaterThan(defaultCtaStart);
    expect(coerceEnd).toBeGreaterThan(coerceStart);
    expect(buildBlock).toContain("ordered.slice(0, 5)");
    expect(buildBlock).not.toContain("ordered.slice(0, 3)");
    expect(coerceBlock).toContain("if (out.length >= 5) break;");
    expect(coerceBlock).not.toContain("if (out.length >= 3) break;");
  });
});
