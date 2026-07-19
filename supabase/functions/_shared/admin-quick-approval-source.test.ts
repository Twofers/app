import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("admin email quick approval", () => {
  it("stores only a single-use token hash on the already closed application table", () => {
    const migration = read("supabase/migrations/20260815120000_admin_email_quick_approval.sql");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS quick_approval_token_hash text/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS quick_approval_token_expires_at timestamptz/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS quick_approval_token_issued_to uuid REFERENCES public\.admin_users/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS quick_approval_token_used_at timestamptz/i);
    expect(migration).toMatch(/idx_business_applications_quick_approval_token_hash/i);
    expect(migration).not.toMatch(/CREATE POLICY|DROP POLICY|CREATE OR REPLACE FUNCTION/i);
  });

  it("mints only low-risk pending links for active decision-capable admins", () => {
    const source = read("supabase/functions/_shared/admin-quick-approval.ts");
    expect(source).toMatch(/QUICK_APPROVAL_TTL_MINUTES\s*=\s*30/);
    expect(source).toMatch(/crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
    expect(source).toMatch(/crypto\.subtle\.digest\("SHA-256"/);
    expect(source).toMatch(/applicationStatus === "pending_review"/);
    expect(source).toMatch(/accessTier === "pending_verification"/);
    expect(source).toMatch(/verificationStatus === "verified_low_risk"/);
    expect(source).toMatch(/riskScore >= 70/);
    expect(source).toMatch(/from\("admin_users"\)/);
    expect(source).toMatch(/QUICK_APPROVAL_ROLES/);
    expect(source).toMatch(/hasPossibleDuplicate/);
    expect(source).toMatch(/quick_approval_token_hash: tokenHash/);
    expect(source).toMatch(/#token=\$\{encodeURIComponent\(rawToken\)\}/);
    expect(source).not.toMatch(/console\.[a-z]+\([^;]*rawToken/);
  });

  it("previews without mutation and confirms through the audited setup-only decision", () => {
    const source = read("supabase/functions/admin-business-applications/index.ts");
    expect(source).toMatch(/QUICK_APPROVAL_ACTIONS/);
    expect(source).toMatch(/quick_preview/);
    expect(source).toMatch(/quick_confirm/);
    expect(source).toMatch(/quickApprovalTokenHash\(rawToken\)/);
    expect(source).toMatch(/quickApprovalApplicationIsEligible/);
    expect(source).toMatch(/quick_approval_processing_request_id: requestId/);
    expect(source).toMatch(/is\("quick_approval_token_used_at", null\)/);
    expect(source).toMatch(/await applyDecision\([\s\S]*"approve_setup"/);
    expect(source).toMatch(/Approved for setup; 30-day trial starts only after verified Stripe activation/);
    expect(source).toMatch(/quick_approval_token_used_at: usedAt/);
    expect(source).not.toMatch(/quick_confirm[\s\S]{0,500}"approve_limited"/);
  });

  it("requires a separate confirmation click and removes the fragment before network requests", () => {
    const page = read("website/quick-approve-trial/index.html");
    const script = read("website/quick-approve-trial/quick-approve.js");
    const vercel = read("website/vercel.json");
    expect(page).toMatch(/data-quick-approval-endpoint/);
    expect(page).toMatch(/data-confirm-quick-approval/);
    expect(page).toMatch(/Opening this page has not approved anything/);
    expect(script).toMatch(/window\.history\.replaceState/);
    expect(script).toMatch(/post\("quick_preview"\)/);
    expect(script).toMatch(/addEventListener\("click"[\s\S]*post\("quick_confirm"\)/);
    expect(script.indexOf('post("quick_preview")')).toBeLessThan(script.indexOf('post("quick_confirm")'));
    expect(vercel).toMatch(/\/quick-approve-trial/);
    expect(vercel).toMatch(/Referrer-Policy[\s\S]*no-referrer/);
    expect(vercel).toMatch(/Cache-Control[\s\S]*no-store/);
  });
});
