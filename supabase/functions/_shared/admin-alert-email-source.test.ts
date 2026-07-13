import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("new-application admin alert email", () => {
  it("sends via Resend, is best-effort, and never leaks secrets", () => {
    const source = read("supabase/functions/_shared/admin-alert-email.ts");
    expect(source).toMatch(/api\.resend\.com\/emails/);
    expect(source).toMatch(/Deno\.env\.get\("RESEND_API_KEY"\)/);
    // Destination inbox is configurable but defaults to support@ (no new secret required).
    expect(source).toMatch(/Deno\.env\.get\("ADMIN_ALERT_EMAIL"\)/);
    expect(source).toMatch(/support@twoferapp\.com/);
    expect(source).toMatch(/Approve 30-day full trial/);
    expect(source).toMatch(/Opening it does not approve the business/);
    expect(source).toMatch(/\/admin\/trial-requests\/\?status=open/);
    // Best-effort contract: returns a warning string instead of throwing.
    expect(source).toMatch(/Promise<string \| null>/);
    // Never log the API key, and never echo the provider response body.
    expect(source).not.toMatch(/console\.[a-z]+\([^;]*resendApiKey/);
    expect(source).not.toMatch(/response\.text\(\)/);
  });

  it("fires from the public application intake after the insert succeeds", () => {
    const source = read("supabase/functions/submit-business-application/index.ts");
    expect(source).toMatch(
      /import \{ adminAlertInbox, sendNewApplicationAdminAlert \} from "\.\.\/_shared\/admin-alert-email\.ts"/,
    );
    // Must be awaited only after the insert's error guard, before the response.
    expect(source).toMatch(/if \(error\) throw error;[\s\S]*await sendNewApplicationAdminAlert\(/);
    expect(source).toMatch(/applicationId: application\.id as string/);
    expect(source).toMatch(/mintFullTrialQuickApproval/);
    expect(source).toMatch(/sendNewApplicationAdminAlert\([\s\S]*quickApprovalUrl\)/);
  });
});
