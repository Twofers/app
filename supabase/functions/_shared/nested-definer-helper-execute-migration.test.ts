import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824144000_revoke_nested_definer_helper_client_execute.sql",
  ),
  "utf8",
);

const executable = migration
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("nested definer helper client execution hardening migration", () => {
  it("revokes client execution from exactly the three nested-only helpers", () => {
    for (const signature of [
      "public\\.admin_role\\(\\)",
      "public\\.business_member_role\\(uuid\\)",
      "public\\.get_runtime_billing_config\\(\\)",
    ]) {
      expect(executable).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION ${signature}\\s+FROM PUBLIC, anon, authenticated;`, "i"),
      );
    }
    expect(executable.match(/REVOKE EXECUTE ON FUNCTION/gi)).toHaveLength(3);
  });

  it("leaves the client-facing wrapper functions alone", () => {
    // These are the functions clients and policies actually call. Revoking any
    // of them would break admin checks, membership checks, or billing reads.
    for (const wrapper of [
      "admin_can",
      "is_admin",
      "is_owner_admin",
      "is_business_member",
      "get_location_billing_summary",
    ]) {
      expect(executable).not.toMatch(new RegExp(`REVOKE[^;]*\\b${wrapper}\\b`, "i"));
    }
  });

  it("changes no behavior, grant, or data", () => {
    expect(executable).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i);
    expect(executable).not.toMatch(/\bGRANT\b/i);
    expect(executable).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);
    expect(executable).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(migration).toMatch(/^\s*BEGIN;/m);
    expect(migration).toMatch(/^\s*COMMIT;/m);
  });
});
