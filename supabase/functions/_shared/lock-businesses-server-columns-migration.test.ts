import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260804120000_lock_businesses_server_columns.sql",
  ),
  "utf8",
);

// Finding 01 (money & trust audit): a business owner must never be able to
// PATCH their own businesses row to self-grant access_level='admin_comped'
// (or tamper with admin trust/audit fields). Enforced via a BEFORE INSERT OR
// UPDATE trigger, not RLS WITH CHECK (which cannot compare OLD vs NEW).
const BASE_PROTECTED_COLUMNS = [
  "owner_id",
  "access_level",
  "status",
  "can_publish_cached",
  "is_demo",
];
const ADMIN_TRUST_COLUMNS = [
  "verification_status",
  "risk_score",
  "risk_level",
  "first_approved_at",
  "approved_by",
  "suspended_at",
  "suspended_by",
  "suspension_reason",
  "admin_notes",
  "source",
  "launch_area_id",
  "source_onboarding_request_id",
  "current_profile_version",
  "profile_completion_score",
  "last_profile_completed_at",
  "last_sensitive_edit_at",
];

describe("lock_businesses_server_columns migration", () => {
  it("bypasses the freeze only for service_role or a verified admin, with NULL-safe checks", () => {
    expect(migration).toMatch(
      /v_privileged boolean := \(COALESCE\(auth\.role\(\), ''\) = 'service_role'\) OR COALESCE\(public\.is_admin\(\), false\)/,
    );
  });

  it("forces safe defaults on INSERT and freezes to OLD on UPDATE for every protected column", () => {
    for (const column of [...BASE_PROTECTED_COLUMNS, ...ADMIN_TRUST_COLUMNS]) {
      if (column === "owner_id") {
        // owner_id is intentionally not forced on INSERT (RLS WITH CHECK
        // already constrains it to auth.uid()); it is still frozen on UPDATE.
        expect(migration).toMatch(new RegExp(`NEW\\.owner_id\\s*:= OLD\\.owner_id;`));
        continue;
      }
      const insertPattern = new RegExp(`NEW\\.${column}\\s*:=`);
      const updatePattern = new RegExp(`NEW\\.${column}\\s*:= OLD\\.${column};`);
      expect(migration).toMatch(insertPattern);
      expect(migration).toMatch(updatePattern);
    }
  });

  it("does not freeze the merchant's own repeat-visit policy columns", () => {
    expect(migration).not.toMatch(/NEW\.repeat_claim_policy_type/);
    expect(migration).not.toMatch(/NEW\.repeat_claim_cooldown_days/);
  });

  it("installs the BEFORE INSERT OR UPDATE trigger on public.businesses", () => {
    expect(migration).toMatch(
      /CREATE TRIGGER businesses_protect_server_columns\s*\n\s*BEFORE INSERT OR UPDATE ON public\.businesses/,
    );
  });
});
