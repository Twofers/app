import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Web-attack review 2026-07-31, findings M-3 (PostgREST .or() email injection)
// and M-4 (non-atomic single-use claim-link counter).
describe("PostgREST .or() email sanitization (M-3)", () => {
  it("the shared sanitizer strips the or-grammar metacharacters", () => {
    const helper = read("supabase/functions/_shared/postgrest-or-filter.ts");
    expect(helper).toMatch(/replace\(\/\[,\(\)"\]\/g, ""\)/);
  });

  const files = [
    "update-business-profile-section",
    "accept-business-terms",
    "set-promo-materials-authorization",
  ];
  for (const fn of files) {
    it(`${fn} sanitizes the interpolated email in its .or() filter`, () => {
      const source = read(`supabase/functions/${fn}/index.ts`);
      // The raw interpolation must be gone; the sanitized form must be present.
      expect(source).not.toMatch(/invited_email\.eq\.\$\{email\}/);
      expect(source).toMatch(/invited_email\.eq\.\$\{sanitizeOrFilterValue\(email\)\}/);
      expect(source).toMatch(/from "\.\.\/_shared\/postgrest-or-filter\.ts"/);
    });
  }
});

describe("atomic business-claim-link use consumption (M-4)", () => {
  it("business-claim-link consumes the use via the atomic RPC and drops the manual increment", () => {
    const source = read("supabase/functions/business-claim-link/index.ts");
    expect(source).toMatch(/rpc\(\s*\n?\s*"consume_business_claim_link_use"/);
    // The old read-modify-write increment must be gone.
    expect(source).not.toMatch(/uses_count: Number\(link\.uses_count\) \+ 1/);
    // Fail-closed: a non-winning caller is rejected.
    expect(source).toMatch(/consumedUse !== true/);
  });

  it("the migration uses a single conditional UPDATE guarded by uses_count < max_uses", () => {
    const migration = read(
      "supabase/migrations/20260824145000_consume_business_claim_link_use_rpc.sql",
    );
    expect(migration).toMatch(/UPDATE public\.business_claim_links/);
    expect(migration).toMatch(/SET uses_count = uses_count \+ 1/);
    expect(migration).toMatch(/AND uses_count < max_uses/);
    expect(migration).toMatch(/GET DIAGNOSTICS v_updated = ROW_COUNT/);
    // Service-role only.
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.consume_business_claim_link_use\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.consume_business_claim_link_use\([^)]*\) TO service_role/);
  });
});
