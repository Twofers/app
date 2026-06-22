import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260726132000_business_trial_identity_controls.sql"),
  "utf8",
);

describe("business trial identity controls migration", () => {
  it("adds a server-owned duplicate review queue", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_duplicate_review_queue/i);
    expect(migration).toMatch(/reason IN \('google_place_id', 'address_phone', 'address_business_name'\)/i);
    expect(migration).toMatch(/ALTER TABLE public\.business_duplicate_review_queue ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.business_duplicate_review_queue FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON TABLE public\.business_duplicate_review_queue TO service_role/i);
  });

  it("normalizes identity signals and blocks high-confidence prior trial matches", () => {
    expect(migration).toMatch(/normalize_business_identity_text/i);
    expect(migration).toMatch(/normalize_business_identity_phone/i);
    expect(migration).toMatch(/refresh_business_location_identity/i);
    expect(migration).toMatch(/check_business_location_trial_reuse/i);
    expect(migration).toMatch(/trial_used_at IS NOT NULL/i);
    expect(migration).toMatch(/RETURN QUERY SELECT 'block'::text[\s\S]+address_phone/i);
    expect(migration).toMatch(/RETURN QUERY SELECT 'review'::text[\s\S]+address_business_name/i);
  });

  it("keeps owner clients from invoking duplicate checks directly", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.check_business_location_trial_reuse\(uuid\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.check_business_location_trial_reuse\(uuid\) TO service_role/i);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.check_business_location_trial_reuse\(uuid\) TO authenticated/i);
  });
});
