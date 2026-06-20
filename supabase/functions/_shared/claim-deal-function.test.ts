import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "claim-deal", "index.ts"),
  "utf8",
);

describe("claim-deal edge function", () => {
  it("translates atomic max-claims trigger errors into sold-out responses", () => {
    expect(source).toMatch(/function isClaimLimitReachedError/);
    expect(source).toMatch(/MAX_CLAIMS_REACHED\|CLAIM_LIMIT_REACHED/);
    expect(source).toMatch(/This deal has reached its claim limit\./);
    expect(source).toMatch(/status:\s*409/);
  });
});
