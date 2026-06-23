import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "send-deal-push", "index.ts"),
  "utf8",
);

function functionBlock(name: string): string {
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);

  const signatureEnd = source.indexOf("\n", start);
  const bodyStart = source.lastIndexOf("{", signatureEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

describe("send-deal-push multilingual rollout source guards", () => {
  it("does not perform notification-send-time translation or localization lookups", () => {
    expect(source).toMatch(/buildDeterministicDealChannelCopy/);
    expect(source).toMatch(/validateDealEligibility/);
    expect(source).toMatch(/sendExpoPushBatch/);

    expect(source).not.toMatch(/generateStructuredText/);
    expect(source).not.toMatch(/ai-translate-deal/);
    expect(source).not.toMatch(/reviewAdLocalizationSemanticQa/);
    expect(source).not.toMatch(/customer_deal_localizations/);
    expect(source).not.toMatch(/localization_bundle/);
    expect(source).not.toMatch(/title_es|title_ko|description_es|description_ko/);
    expect(source).not.toMatch(/operation:\s*"translation"/);
  });

  it("builds push copy from structured offer facts rather than localized customer display state", () => {
    const block = functionBlock("buildPushCopy");

    expect(block).toMatch(/dealEligibilityFromRow/);
    expect(block).toMatch(/buildDealOfferContract/);
    expect(block).toMatch(/buildDeterministicDealChannelCopy/);
    expect(block).toMatch(/copy\.pushTitle/);
    expect(block).toMatch(/copy\.pushBody/);
    expect(block).not.toMatch(/buildLocalizedDealDisplay/);
    expect(block).not.toMatch(/localizedDealTitle/);
    expect(block).not.toMatch(/localizedDealDescription/);
  });
});
