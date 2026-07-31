import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824132000_remove_public_bucket_listing_policies.sql",
  ),
  "utf8",
);

describe("public bucket listing hardening migration", () => {
  it.each([
    "Public read business-logos objects",
    "Public read deal-photos objects",
  ])("drops the broad %s policy", (policy) => {
    expect(migration).toMatch(
      new RegExp(
        `DROP POLICY IF EXISTS "${policy}"\\s+ON storage\\.objects`,
        "i",
      ),
    );
  });

  it("does not make either public asset bucket private", () => {
    expect(migration).not.toMatch(
      /UPDATE\s+storage\.buckets[\s\S]+SET\s+public\s*=\s*false/i,
    );
    expect(migration).not.toMatch(/DELETE\s+FROM\s+storage\.buckets/i);
  });

  it("does not alter owner upload, update, or delete policies", () => {
    expect(migration).not.toMatch(
      /Business owner(?:s)? (?:upload|update|delete)/i,
    );
    expect(migration).not.toMatch(
      /(?:CREATE|ALTER|DROP)\s+POLICY[\s\S]+(?:upload|update|delete)/i,
    );
  });
});
