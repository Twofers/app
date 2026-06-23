import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const createAiSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const homeSource = readFileSync(join(process.cwd(), "app", "(tabs)", "index.tsx"), "utf8");
const detailSource = readFileSync(join(process.cwd(), "app", "deal", "[id].tsx"), "utf8");

describe("composed ad card preview/customer parity source guards", () => {
  it("keeps merchant preview, Home feed, and Deal Detail on the same composed renderer when enabled", () => {
    for (const source of [createAiSource, homeSource, detailSource]) {
      expect(source).toMatch(/ComposedAdCard/);
      expect(source).toMatch(/buildDefaultAdPresentationSpec/);
      expect(source).toMatch(/buildApprovedAdCopy/);
      expect(source).toMatch(/buildMerchantIdentity/);
      expect(source).toMatch(/renderAuthoritativeOffer/);
    }
  });

  it("keeps customer surfaces behind the shared renderer flag", () => {
    expect(homeSource).toMatch(/isAiV4SharedRendererEnabled/);
    expect(detailSource).toMatch(/isAiV4SharedRendererEnabled/);
  });
});
