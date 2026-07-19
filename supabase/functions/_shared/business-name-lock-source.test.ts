import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Business name lock (migration 20260816120000): the "publicly visible"
// status list exists in THREE places that must never drift:
//   1. SQL      public.is_public_business_status
//   2. Deno     supabase/functions/_shared/business-identity-lock.ts
//   3. RN app   lib/business-name-lock.ts
// and the two enforcement points (trigger + edge function) must both be
// present — the edge function writes as service_role and bypasses the
// trigger, so losing either one silently reopens the rename spoof.

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase", "migrations", "20260816120000_business_name_change_requests.sql"),
  "utf8",
);
const denoTwin = readFileSync(
  join(root, "supabase", "functions", "_shared", "business-identity-lock.ts"),
  "utf8",
);
const clientTwin = readFileSync(join(root, "lib", "business-name-lock.ts"), "utf8");
const edgeFn = readFileSync(
  join(root, "supabase", "functions", "update-business-profile-section", "index.ts"),
  "utf8",
);
const visibilityMigration = readFileSync(
  join(root, "supabase", "migrations", "20260814120000_public_business_predicate_and_publish_gate.sql"),
  "utf8",
);
const activationMigration = readFileSync(
  join(root, "supabase", "migrations", "20260817120000_approved_not_activated_activation_gate.sql"),
  "utf8",
);

const NON_PUBLIC = ["draft", "pending_verification", "approved_not_activated", "rejected"];

function tsListOf(source: string): string[] {
  const m = source.match(/NON_PUBLIC_BUSINESS_STATUSES = \[([^\]]+)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("business name lock — status list sync", () => {
  it("the latest SQL predicate also hides approved setup workspaces", () => {
    expect(activationMigration).toMatch(
      /is_public_business_status[\s\S]*?NOT IN \('draft', 'pending_verification', 'approved_not_activated', 'rejected'\)/,
    );
  });

  it("matches the original is_publicly_visible_business list from 20260814120000", () => {
    expect(visibilityMigration).toMatch(/NOT IN \('draft', 'pending_verification', 'rejected'\)/);
  });

  it("Deno and client twins carry the same list", () => {
    expect(tsListOf(denoTwin)).toEqual(NON_PUBLIC);
    expect(tsListOf(clientTwin)).toEqual(NON_PUBLIC);
  });
});

describe("business name lock — both enforcement points exist", () => {
  it("trigger rejects a changed name once publicly visible (direct PostgREST path)", () => {
    expect(migration).toMatch(
      /IF NEW\.name IS DISTINCT FROM OLD\.name AND public\.is_public_business_status\(OLD\.status\) THEN/,
    );
    expect(migration).toMatch(/RAISE EXCEPTION 'business_name_locked'/);
    expect(migration).toMatch(/ERRCODE = '42501'/);
  });

  it("edge function enforces the same rule (service_role bypasses the trigger)", () => {
    expect(edgeFn).toMatch(/isPublicBusinessStatus\(current\.status\)/);
    expect(edgeFn).toMatch(/nameChanged && isPublicBusinessStatus/);
    expect(edgeFn).toMatch(/BUSINESS_NAME_LOCKED_ERROR/);
  });

  it("trigger only fires on an actual rename (stale builds resending the same name keep saving)", () => {
    expect(migration).toMatch(/IS DISTINCT FROM/);
  });
});

describe("business_name_change_requests table", () => {
  it("allows only one pending request per business", () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX[\s\S]*?WHERE status = 'pending'/);
  });

  it("owners can never self-decide a request", () => {
    // INSERT and UPDATE policies both pin decided_* to NULL and constrain status.
    expect(migration).toMatch(/FOR INSERT[\s\S]*?status = 'pending'[\s\S]*?decided_by IS NULL/);
    expect(migration).toMatch(
      /FOR UPDATE[\s\S]*?status IN \('pending', 'canceled'\)[\s\S]*?decided_by IS NULL/,
    );
  });

  it("anon has no access", () => {
    expect(migration).toMatch(/REVOKE ALL ON public\.business_name_change_requests FROM PUBLIC, anon/);
  });
});
