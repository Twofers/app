import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Text-level guard for the role-immutability migration. Live behavior is
// verified by scripts/db-tests/2b-role-enforcement.mjs against the test project.
const sql = readFileSync(
  path.resolve(
    __dirname,
    "../../migrations/20260808120000_profiles_role_immutable.sql"
  ),
  "utf8"
);

describe("profiles_role_immutable migration", () => {
  it("creates a BEFORE UPDATE trigger on public.profiles", () => {
    expect(sql).toMatch(/CREATE TRIGGER profiles_role_immutable/);
    expect(sql).toMatch(/BEFORE UPDATE ON public\.profiles/);
    expect(sql).toMatch(/EXECUTE FUNCTION public\.enforce_profiles_role_immutable\(\)/);
  });

  it("blocks changes to an already-set role, allowing NULL -> value adoption", () => {
    expect(sql).toMatch(/OLD\.role IS NOT NULL AND NEW\.role IS DISTINCT FROM OLD\.role/);
    expect(sql).toMatch(/RAISE EXCEPTION 'PROFILES_ROLE_IMMUTABLE'/);
  });

  it("fails closed on a missing JWT claim (RLS NULL-claim incident rule)", () => {
    // A NULL claim must coalesce to '' (not service_role), never pass the check.
    expect(sql).toMatch(/COALESCE\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/);
  });

  it("keeps a service_role escape hatch for support tooling", () => {
    expect(sql).toMatch(/service_role/);
  });
});
