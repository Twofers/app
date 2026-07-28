import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("admin owner email", () => {
  it("stores communications behind forced service-role-only RLS", () => {
    const migration = read("supabase/migrations/20260824121000_admin_owner_communications.sql");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.admin_owner_communications/i);
    expect(migration).toMatch(/status IN \('draft', 'sent'\)/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/AS RESTRICTIVE/);
    expect(migration).toMatch(/COALESCE\(false, false\)/);
    expect(migration).toMatch(/REVOKE ALL ON public\.admin_owner_communications FROM PUBLIC, anon, authenticated/);
  });

  it("uses the prompt registry with a deterministic fallback and verified facts", () => {
    const helper = read("supabase/functions/_shared/admin-ai.ts");
    const source = read("supabase/functions/admin-owner-email/index.ts");
    expect(helper).toMatch(/\| "owner_email"/);
    expect(source).toMatch(/feature: "owner_email"/);
    expect(source).toMatch(/deterministicDraft/);
    expect(source).toMatch(/verifiedFacts/);
    expect(source).toMatch(/requiresHumanReview: true/);
    expect(source).toMatch(/Never promise or imply an account change/);
  });

  it("requires reviewed editable text to send and sanitizes provider failures", () => {
    const source = read("supabase/functions/admin-owner-email/index.ts");
    expect(source).toMatch(/payload\.reviewed !== true/);
    expect(source).toMatch(/subject\.length < 3 \|\| body\.length < 20/);
    expect(source).toMatch(/admin_owner_email_sent/);
    expect(source).toMatch(/Twofer <support@twoferapp\.com>/);
    expect(source).not.toMatch(/await response\.text\(\)/);
    expect(source).not.toMatch(/action_link|checkout_token|service_role_key/i);
  });

  it("registers the function and ships the reviewed composer plus history route", () => {
    const config = read("supabase/config.toml");
    const composer = read("website/admin/owner-email.js");
    const page = read("website/admin/communications/index.html");
    expect(config).toMatch(/\[functions\.admin-owner-email\][\s\S]*verify_jwt\s*=\s*false/);
    expect(composer).toMatch(/I reviewed and edited this exact subject and body/);
    expect(composer).toMatch(/save_draft/);
    expect(composer).toMatch(/reviewed/);
    expect(page).toMatch(/Owner Communications/);
  });
});
