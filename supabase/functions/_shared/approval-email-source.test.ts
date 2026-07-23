import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("business approval trial-welcome email", () => {
  it("adds send-idempotency + hashed checkout-token columns without touching RLS", () => {
    const migration = read("supabase/migrations/20260809120000_business_approval_email.sql");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS approval_email_sent_at timestamptz/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS approval_email_decision text/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS checkout_token_hash text/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS checkout_token_expires_at timestamptz/i);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_business_applications_checkout_token_hash/i);
    // Additive only: this migration must not alter policies or policy helpers.
    expect(migration).not.toMatch(/CREATE POLICY|DROP POLICY|CREATE OR REPLACE FUNCTION/i);
  });

  it("sends via Resend, is idempotent, stores only the token hash, and never leaks secrets", () => {
    const source = read("supabase/functions/_shared/approval-email.ts");
    expect(source).toMatch(/api\.resend\.com\/emails/);
    expect(source).toMatch(/Deno\.env\.get\("RESEND_API_KEY"\)/);
    // Idempotency: skip if already sent.
    expect(source).toMatch(/\.select\("approval_email_sent_at"\)/);
    expect(source).toMatch(/if \(current\?\.approval_email_sent_at\) return null;/);
    // Persist only the hash; the raw token lives only in the emailed link.
    expect(source).toMatch(/checkout_token_hash: tokenHash/);
    expect(source).toMatch(/\/business\/billing\/checkout\/\$\{rawToken\}/);
    // Best-effort contract: returns a warning string instead of throwing.
    expect(source).toMatch(/Promise<string \| null>/);
    expect(source).toMatch(/support@twoferapp\.com/);
    // Never log the API key, the raw token, or the provider response body.
    expect(source).not.toMatch(/console\.[a-z]+\([^;]*resendApiKey/);
    expect(source).not.toMatch(/console\.[a-z]+\([^;]*rawToken/);
    expect(source).not.toMatch(/response\.text\(\)/);
  });

  it("emails only on approval decisions from the trial-request / field-invite path", () => {
    const source = read("supabase/functions/admin-business-applications/index.ts");
    expect(source).toMatch(/import \{[\s\S]*sendApprovalEmail,[\s\S]*\} from "\.\.\/_shared\/approval-email\.ts"/);
    expect(source).toMatch(/if \(isSetupApprovalDecision\(decision\)\) \{[\s\S]*sendApprovalEmail\(/);
    expect(source).toMatch(/approval_email_warning: approvalEmailWarning/);
  });

  it("emails on the prospect-to-trial approval path too", () => {
    const source = read("supabase/functions/admin-trial-create-from-prospect/index.ts");
    expect(source).toMatch(/import \{ sendApprovalEmail \} from "\.\.\/_shared\/approval-email\.ts"/);
    expect(source).toMatch(/await sendApprovalEmail\(/);
    expect(source).toMatch(/approval_email_warning: approvalEmailWarning/);
  });

  it("surfaces the email warning on the admin dashboards", () => {
    const trialRequests = read("website/admin/trial-requests.js");
    const newTrial = read("website/admin/admin-new-trial.js");
    expect(trialRequests).toMatch(/approval_email_warning/);
    expect(newTrial).toMatch(/approval_email_warning/);
  });

  it("serves a checkout page that redirects to Stripe or prompts app signup", () => {
    const page = read("website/business/billing/checkout/index.html");
    const script = read("website/business/billing/checkout/checkout.js");
    const vercel = read("website/vercel.json");
    expect(page).toMatch(/data-checkout-endpoint=/);
    expect(page).toMatch(/\/business\/billing\/checkout\/checkout\.js/);
    expect(script).toMatch(/window\.location\.href = payload\.url/);
    expect(script).toMatch(/signup_required/);
    expect(vercel).toMatch(/\/business\/billing\/checkout\/:token/);
  });
});
