import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260725121000_business_media_import_jobs.sql"),
  "utf8",
);

describe("business media import jobs migration", () => {
  it("is marked as an approval-gated draft", () => {
    expect(migration).toMatch(/Do not apply without Dan's[\s\S]+explicit migration approval/i);
  });

  it("creates observable import jobs for website and social discovery", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_media_import_jobs/i);
    expect(migration).toMatch(/source_type IN \('website', 'instagram', 'facebook'\)/i);
    expect(migration).toMatch(/requested_url text/i);
    expect(migration).toMatch(/social_connection_id uuid REFERENCES public\.business_social_connections/i);
    expect(migration).toMatch(/normalized_origin text/i);
  });

  it("tracks bounded progress and terminal states", () => {
    for (const status of [
      "queued",
      "fetching",
      "analyzing",
      "awaiting_approval",
      "importing",
      "completed",
      "failed",
    ]) {
      expect(migration).toMatch(new RegExp(`'${status}'`, "i"));
    }
    expect(migration).toMatch(/pages_scanned integer NOT NULL DEFAULT 0/i);
    expect(migration).toMatch(/candidate_count integer NOT NULL DEFAULT 0/i);
    expect(migration).toMatch(/approved_count integer NOT NULL DEFAULT 0/i);
    expect(migration).toMatch(/approved_count <= candidate_count/i);
  });

  it("requires website jobs to carry a URL and social jobs to use a connection reference", () => {
    expect(migration).toMatch(/business_media_import_jobs_source_payload_check/i);
    expect(migration).toMatch(/source_type = 'website'[\s\S]+requested_url IS NOT NULL/i);
    expect(migration).toMatch(/source_type IN \('instagram', 'facebook'\)[\s\S]+social_connection_id IS NOT NULL/i);
  });

  it("enables RLS, blocks anon, and grants owner read-only access", () => {
    expect(migration).toMatch(/ALTER TABLE public\.business_media_import_jobs ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.business_media_import_jobs FROM anon, authenticated/i);
    expect(migration).not.toMatch(/GRANT [^;]+ TO anon/i);
    expect(migration).toMatch(/GRANT SELECT ON public\.business_media_import_jobs TO authenticated/i);
    expect(migration).toMatch(/Owners can read their media import jobs/i);
    expect(migration).toMatch(/b\.owner_id = auth\.uid\(\)/i);
  });

  it("keeps writes server-controlled and avoids raw social tokens", () => {
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.business_media_import_jobs TO service_role/i);
    expect(migration).not.toMatch(/access_token/i);
    expect(migration).not.toMatch(/refresh_token/i);
    expect(migration).not.toMatch(/GRANT INSERT ON public\.business_media_import_jobs TO authenticated/i);
    expect(migration).not.toMatch(/GRANT UPDATE ON public\.business_media_import_jobs TO authenticated/i);
  });
});
