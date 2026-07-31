import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "complete-visual-redeem", "index.ts"),
  "utf8",
);
const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260804122000_allow_visual_redemption_audit_rows.sql"),
  "utf8",
);

// Finding 06 Option 1 (Dan confirmed 2026-07-06): customer-completed visual
// redeem stays for the pilot, but must bind to the deal's location and write
// the same audit trail staff/owner redemptions get.
describe("complete-visual-redeem location binding and audit trail (Finding 06)", () => {
  it("rejects a client-supplied location that mismatches the claim's location", () => {
    expect(source).toMatch(/clientLocationId && claim\.location_id && clientLocationId !== claim\.location_id/);
    expect(source).toMatch(/WRONG_LOCATION_REDEMPTION/);
  });

  it("records redeemed_at_location_id on the claim", () => {
    expect(source).toMatch(/redeemed_at_location_id:\s*claim\.location_id/);
  });

  it("writes a redemptions audit row via the service-role client", () => {
    expect(source).toMatch(/supabaseAdmin\.from\("redemptions"\)\.insert\(/);
    expect(source).toMatch(/redeem_method:\s*"visual"/);
    expect(source).toMatch(/code_type:\s*"visual"/);
  });
});

// Manual "staff can't scan it" fallback (Dan, 2026-07-25). The 14s MIN_MS wait
// is a countdown-pacing device, not a fraud control, and a double-tap has no
// countdown to pace — so `manual: true` skips it and NOTHING else.
describe("complete-visual-redeem manual completion", () => {
  it("exempts a manual completion from the pacing wait only", () => {
    expect(source).toMatch(/const isManualCompletion = body\.manual === true;/);
    expect(source).toMatch(/if \(!isManualCompletion && elapsed < MIN_MS\)/);
  });

  it("keeps every real guard unconditional for manual completions", () => {
    // Each of these must remain untouched by isManualCompletion, or the
    // fallback would become a way to redeem someone else's / an expired claim.
    for (const guard of [
      /if \(claim\.user_id !== user\.id\)/,
      /if \(isPastRedeemDeadline\(/,
      /if \(claim\.claim_status !== "redeeming" \|\| !claim\.redeem_started_at\)/,
      /if \(clientLocationId && claim\.location_id && clientLocationId !== claim\.location_id\)/,
      /if \(elapsed > MAX_MS\)/,
    ]) {
      expect(source).toMatch(guard);
    }
    // Tightest honest statement of "pacing only": the flag is referenced exactly
    // twice — where it is read from the body, and in the MIN_MS branch. Any new
    // reference means it started gating something else and must be reviewed.
    const references = source.match(/isManualCompletion/g) ?? [];
    expect(references).toHaveLength(2);
  });

  it("is requested by the client helper that drives the double-tap", () => {
    const client = readFileSync(join(process.cwd(), "lib", "manual-redeem.ts"), "utf8");
    // Both halves have to agree or the fallback silently hits the 14s wait.
    expect(client).toMatch(/body: \{ claim_id: claimId, manual: true \}/);
    expect(client).toMatch(/beginVisualRedeem\(claimId\)/);
  });
});

describe("allow_visual_redemption_audit_rows migration", () => {
  it("widens redeem_method and code_type to allow visual", () => {
    expect(migration).toMatch(
      /CHECK \(redeem_method IN \('staff_qr', 'staff_manual', 'visual'\)\)/,
    );
    expect(migration).toMatch(/CHECK \(code_type IN \('token', 'short_code', 'visual'\)\)/);
  });
});
