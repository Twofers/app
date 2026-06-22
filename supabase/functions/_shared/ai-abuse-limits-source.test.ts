import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sharedLimits = readFileSync(join(process.cwd(), "supabase", "functions", "_shared", "ai-limits.ts"), "utf8");
const dealCopy = readFileSync(join(process.cwd(), "supabase", "functions", "ai-generate-deal-copy", "index.ts"), "utf8");
const aiAds = readFileSync(join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"), "utf8");
const createAi = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const creditEnforcement = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "deal-credit-enforcement.ts"),
  "utf8",
);

describe("AI abuse limit source guards", () => {
  it("keeps the shared monthly AI feature limit at 30 by default", () => {
    expect(sharedLimits).toMatch(/AI_MONTHLY_LIMIT"\) \?\? "30"/);
    expect(sharedLimits).not.toMatch(/AI_MONTHLY_LIMIT"\) \?\? "60"/);
  });

  it("keeps deal-copy generation at 30 per month by default", () => {
    expect(dealCopy).toMatch(/AI_COPY_MONTHLY_LIMIT"\) \?\? "30"/);
    expect(dealCopy).not.toMatch(/AI_COPY_MONTHLY_LIMIT"\) \?\? "60"/);
  });

  it("keeps AI Ads revisions capped at two before extra credit handling", () => {
    expect(createAi).toMatch(/SOFT_REVISION_CAP = 2/);
    expect(aiAds).toMatch(/MAX_REVISION_COUNT = INCLUDED_IMAGE_REVISIONS/);
    expect(creditEnforcement).toMatch(/INCLUDED_IMAGE_REVISIONS = 2/);
    expect(createAi).not.toMatch(/SOFT_REVISION_CAP = 5/);
    expect(aiAds).not.toMatch(/MAX_REVISION_COUNT = 10/);
  });
});
