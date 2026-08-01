import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Web-attack review 2026-07-31, findings H-3 and M-1: two AI endpoints reached a
// paid provider with no per-account cost control. These pin the added caps.
describe("AI cost caps (H-3, M-1)", () => {
  it("registers the studio_draft quota scope mapped to ai_studio_draft logs", () => {
    const quota = read("supabase/functions/_shared/ai-quota-resets.ts");
    expect(quota).toMatch(/"studio_draft"/);
    expect(quota).toMatch(/case "studio_draft":\s*\n\s*return \["ai_studio_draft"\]/);
  });

  it("ai-studio-generate-draft enforces a cooldown and a monthly cap before generating (H-3)", () => {
    const source = read("supabase/functions/ai-studio-generate-draft/index.ts");
    expect(source).toMatch(/countAiQuotaUsage/);
    expect(source).toMatch(/scope: "studio_draft"/);
    expect(source).toMatch(/COOLDOWN_ACTIVE/);
    expect(source).toMatch(/AI_STUDIO_MONTHLY_LIMIT|AI_STUDIO_DRAFT_MONTHLY_LIMIT/);
    // The cap is enforced in the handler before the request group / generation is
    // set up: the studio_draft quota check precedes the requestGroupId that gates
    // the model-call section.
    const capIdx = source.indexOf('scope: "studio_draft"');
    const groupIdx = source.indexOf("const requestGroupId = crypto.randomUUID()");
    expect(capIdx).toBeGreaterThan(0);
    expect(capIdx).toBeLessThan(groupIdx);
  });

  it("ai-business-lookup rate-limits the OWNER path, not only the applicant path (M-1)", () => {
    const source = read("supabase/functions/ai-business-lookup/index.ts");
    expect(source).toMatch(/owner_rate_limited/);
    // Both branches must reference the shared limit constant.
    const limitHits = source.match(/APPLICANT_LOOKUP_LIMIT/g) ?? [];
    expect(limitHits.length).toBeGreaterThanOrEqual(2);
  });
});
