import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824142000_revoke_location_ownership_helper_client_execute.sql",
  ),
  "utf8",
);

describe("location ownership helper client execution hardening migration", () => {
  it("revokes direct client execution from the ownership helper", () => {
    expect(migration).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.user_owns_business_location\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated;/i,
    );
    expect(migration.match(/REVOKE EXECUTE ON FUNCTION/gi)).toHaveLength(1);
  });

  it("does not alter helper behavior, grants, or data", () => {
    expect(migration).not.toMatch(
      /\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
    );
    expect(migration).not.toMatch(/\bGRANT\b/i);
    expect(migration).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
  });
});
