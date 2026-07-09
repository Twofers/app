import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Text-level guard for the purge_user_data rollback fix. Live behavior is
// verified by scripts/db-tests/2a-purge-user-data.mjs against the test project.
//
// The bug: an EXCEPTION handler on the function's outer block rolls back ALL
// work in that block before handling. With consumer_push_prefs never existing
// as a table, the trailing dynamic DELETE raised undefined_table on every call
// and the "ignore" handler silently undid the entire purge.
const sql = readFileSync(
  path.resolve(
    __dirname,
    "../../migrations/20260808121000_fix_purge_user_data_rollback.sql"
  ),
  "utf8"
);

// The executable part only (ignore the header comment, which narrates the bug).
const body = sql.slice(sql.indexOf("ALTER TABLE public.deal_claims"));

describe("fix_purge_user_data_rollback migration", () => {
  it("makes deal_claims.user_id nullable so anonymization can succeed", () => {
    expect(body).toMatch(/ALTER TABLE public\.deal_claims\s+ALTER COLUMN user_id DROP NOT NULL;/);
  });

  it("still performs every purge action of the previous version", () => {
    expect(body).toMatch(/UPDATE public\.deal_claims/);
    expect(body).toMatch(/session_id_at_claim = NULL/);
    expect(body).toMatch(/UPDATE public\.app_analytics_events/);
    expect(body).toMatch(/DELETE FROM public\.favorites WHERE user_id = p_user_id/);
    expect(body).toMatch(/DELETE FROM public\.push_tokens WHERE user_id = p_user_id/);
    expect(body).toMatch(/DELETE FROM public\.consumer_profiles WHERE user_id = p_user_id/);
  });

  it("isolates the optional-table delete in a nested block", () => {
    // The EXECUTE and its undefined_table handler must live in an inner
    // BEGIN...EXCEPTION...END, i.e. the handler appears AFTER the EXECUTE and
    // is followed by an END that is not the function's final END.
    const inner = body.match(
      /BEGIN\s+EXECUTE 'DELETE FROM public\.consumer_push_prefs[\s\S]*?EXCEPTION\s+WHEN undefined_table THEN\s+NULL;\s+END;/
    );
    expect(inner).not.toBeNull();
  });

  it("has no exception handler on the outer block (nothing can roll back the purge)", () => {
    // Exactly one EXCEPTION clause total — the nested one.
    expect(body.match(/EXCEPTION/g)?.length).toBe(1);
    // The purge statements come BEFORE the nested block's BEGIN, so they are
    // outside any handled (rollback-able) scope.
    expect(body.indexOf("DELETE FROM public.consumer_profiles")).toBeLessThan(
      body.indexOf("EXCEPTION")
    );
  });

  it("keeps the service-role-only execution grants", () => {
    expect(body).toMatch(/REVOKE EXECUTE ON FUNCTION public\.purge_user_data\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(body).toMatch(/GRANT EXECUTE ON FUNCTION public\.purge_user_data\(uuid\) TO service_role;/);
  });
});
