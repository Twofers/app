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

describe("allow_visual_redemption_audit_rows migration", () => {
  it("widens redeem_method and code_type to allow visual", () => {
    expect(migration).toMatch(
      /CHECK \(redeem_method IN \('staff_qr', 'staff_manual', 'visual'\)\)/,
    );
    expect(migration).toMatch(/CHECK \(code_type IN \('token', 'short_code', 'visual'\)\)/);
  });
});
