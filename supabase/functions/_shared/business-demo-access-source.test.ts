import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("business demo access source contract", () => {
  it("confirms only live admin full-access approvals at auth signup", () => {
    const migration = read("supabase/migrations/20260827130000_business_full_access_email_and_demo_ai.sql");
    expect(migration).toMatch(/BEFORE INSERT ON auth\.users/);
    expect(migration).toMatch(/full_access_granted_at \+ make_interval\(days => ba\.full_access_trial_days\) > now\(\)/);
    expect(migration).toMatch(/NEW\.email_confirmed_at := now\(\)/);
    expect(migration).toMatch(/lower\(btrim\(COALESCE\(ba\.approved_email_normalized, ba\.email\)\)\)/);
    expect(migration).toMatch(/confirm_full_access_business_users/);
    expect(read("supabase/functions/admin-business-applications/index.ts")).toMatch(/confirm_full_access_business_users/);
  });

  it("keeps demo generation atomic and leaves publishing disabled", () => {
    const migration = read("supabase/migrations/20260827130000_business_full_access_email_and_demo_ai.sql");
    expect(migration).toMatch(/reserve_demo_ai_generation/);
    expect(migration).toMatch(/pg_advisory_xact_lock\(hashtext\('demo_ai_generation:'/);
    expect(migration).toMatch(/'can_generate_ai', true/);
    expect(migration).toMatch(/'can_publish_offer', false/);

    const edge = read("supabase/functions/ai-generate-ad-variants/index.ts");
    expect(edge).toMatch(/reserve_demo_ai_generation/);
    expect(edge).toMatch(/release_demo_ai_generation/);
    expect(edge).toMatch(/capabilities\.reason_code === "demo"/);
  });
});
