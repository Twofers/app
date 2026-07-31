import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824143000_remove_pilot_business_location_read_policy.sql",
  ),
  "utf8",
);

describe("pilot business-location read policy removal migration", () => {
  it("drops exactly the untracked pilot cross-tenant read policy", () => {
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS "Auth users can read business locations \(pilot\)"\s+ON public\.business_locations;/i,
    );
    expect(migration.match(/DROP POLICY/gi)).toHaveLength(1);
  });

  it("leaves the owner-scoped policy and every grant untouched", () => {
    // The rollback note in the header is the only place a CREATE POLICY string
    // may appear, and it is commented out. Nothing executable may create,
    // alter, or grant anything.
    const executable = migration
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/\bCREATE\s+POLICY\b/i);
    expect(executable).not.toMatch(/\bALTER\s+(?:TABLE|POLICY)\b/i);
    expect(executable).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(executable).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  });

  it("keeps the change inside one transaction", () => {
    expect(migration).toMatch(/^\s*BEGIN;/m);
    expect(migration).toMatch(/^\s*COMMIT;/m);
  });
});
