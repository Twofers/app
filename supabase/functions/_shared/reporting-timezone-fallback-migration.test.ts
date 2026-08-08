import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

const migration = readFileSync(
  join(MIGRATIONS, "20260828120000_reporting_timezone_fallback.sql"),
  "utf8",
);

/** The migration this one supersedes — the source of the two RPC bodies. */
const priorMigration = readFileSync(
  join(MIGRATIONS, "20260601153000_billing_v4_app_config_and_subscription_rls.sql"),
  "utf8",
);

const insightsPanelSource = readFileSync(
  join(process.cwd(), "components", "merchant-insights-panel.tsx"),
  "utf8",
);

describe("reporting timezone fallback migration", () => {
  it("is marked as approval gated", () => {
    expect(migration).toMatch(
      /Do not apply[\s\S]{0,20}without Dan's[\s\S]{0,12}explicit migration approval/i,
    );
  });

  it("resolves deal tz -> that business's last known deal tz -> UTC", () => {
    // The bug: a one-time deal stores NULL timezone, the old COALESCE turned
    // that into 'UTC', and the panel labelled the UTC bucket "local" — a
    // 10:40 PM America/Chicago claim rendered as 3:00 AM.
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.resolve_reporting_timezone\(/i,
    );
    // Deal timezone still wins when present.
    expect(migration).toContain("NULLIF(trim(p_deal_timezone), '')");
    // Fallback is the same business's most recent deal that HAS a timezone.
    expect(migration).toMatch(/FROM public\.deals d2\s+WHERE d2\.business_id = p_business_id/);
    expect(migration).toMatch(/ORDER BY d2\.created_at DESC\s+LIMIT 1/);
    // UTC survives only as the last resort.
    expect(migration).toContain("'UTC'");
  });

  it("routes BOTH insight RPCs through the helper, leaving no bare UTC coalesce", () => {
    expect(migration).toContain(
      "SELECT d.business_id, public.resolve_reporting_timezone(d.timezone, d.business_id)",
    );
    // The business overload resolves once into a variable rather than running
    // the subquery per claim row.
    expect(migration).toContain("v_fallback_tz text;");
    expect(migration).toContain(
      "SELECT public.resolve_reporting_timezone(NULL, p_business_id) INTO v_fallback_tz;",
    );
    expect(migration).toContain("COALESCE(NULLIF(trim(b.timezone), ''), v_fallback_tz) AS tz,");

    // The exact expressions this migration exists to remove must be gone from
    // the executable SQL. Comments may quote them (the header explains the
    // bug), so strip comment lines before asserting.
    const executable = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(executable).not.toContain("COALESCE(NULLIF(trim(d.timezone), ''), 'UTC')");
    expect(executable).not.toContain("COALESCE(NULLIF(trim(b.timezone), ''), 'UTC')");
  });

  it("replaces both overloads with the same signatures (no PGRST203 split)", () => {
    // Adding or defaulting a parameter would mint a SECOND overload and break
    // PostgREST resolution — see the CREATE OR REPLACE overload trap.
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.merchant_deal_insights(p_deal_id uuid)",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.merchant_business_insights(p_business_id uuid)",
    );
    for (const signature of [
      "public.merchant_deal_insights(p_deal_id uuid)",
      "public.merchant_business_insights(p_business_id uuid)",
    ]) {
      expect(priorMigration).toContain(signature);
    }
  });

  it("keeps both RPC bodies otherwise byte-identical to the migration they supersede", () => {
    // These bodies were extracted from 20260601153000 and patched ONLY at the
    // timezone resolution. Anything else drifting means the copy went wrong and
    // the RPCs would silently lose behaviour when this migration is applied.
    const stripped = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .map((line) => line.trim())
        .filter(Boolean);

    const priorLines = stripped(priorMigration);
    const migrationLines = new Set(stripped(migration));

    // Every line of the two prior function bodies must still be present, except
    // exactly the two timezone expressions this migration rewrites.
    const allowedMissing = new Set([
      "SELECT d.business_id, COALESCE(NULLIF(trim(d.timezone), ''), 'UTC')",
      "COALESCE(NULLIF(trim(b.timezone), ''), 'UTC') AS tz,",
    ]);

    const dealStart = priorLines.indexOf(
      "CREATE OR REPLACE FUNCTION public.merchant_deal_insights(p_deal_id uuid)",
    );
    expect(dealStart).toBeGreaterThan(-1);

    const missing = priorLines
      .slice(dealStart)
      .filter((line) => !migrationLines.has(line) && !allowedMissing.has(line));

    expect(missing).toEqual([]);
  });

  it("keeps the client label honest about what the bucket means", () => {
    // The panel calls this "local"; that is only true once the RPC resolves a
    // real timezone. Pin the coupling so the string and the SQL move together.
    expect(insightsPanelSource).toContain("claims_by_hour_local");
  });
});

describe("null deal timezone backfill migration", () => {
  const backfill = readFileSync(
    join(MIGRATIONS, "20260828130000_backfill_null_deal_timezones.sql"),
    "utf8",
  );

  it("is marked as approval gated", () => {
    expect(backfill).toMatch(
      /Do not apply[\s\S]{0,20}without Dan's[\s\S]{0,12}explicit migration approval/i,
    );
  });

  it("only fills rows that have no timezone, and is therefore re-runnable", () => {
    // Must never overwrite a timezone a merchant's deal already carries.
    expect(backfill).toContain("WHERE timezone IS NULL OR trim(timezone) = ''");
    expect(backfill).toContain("UPDATE public.deals");
    // Exactly one UPDATE, and it is the guarded one — an unguarded second
    // statement would silently rewrite timezones merchants already have.
    expect(backfill.match(/UPDATE public\.deals/g) ?? []).toHaveLength(1);
  });

  it("writes the column's own declared default, validated before use", () => {
    // deals.timezone has been TEXT DEFAULT 'America/Chicago' since
    // 20260127000001; the NULLs exist only because the client overrode it.
    expect(backfill).toContain("v_default text := 'America/Chicago'");
    // 20260703120004 adds a CHECK that rejects non-IANA values — guard first
    // so the migration fails loudly rather than aborting mid-UPDATE.
    expect(backfill).toContain("public.is_valid_iana_timezone(v_default)");
    expect(backfill).toMatch(/RAISE EXCEPTION 'backfill aborted/);
  });

  it("documents that it asserts a timezone, and why UTC was worse", () => {
    // This is a judgement call on historical data — it must stay legible to
    // whoever reads the migration later.
    expect(backfill).toMatch(/ACCURACY NOTE/);
    expect(backfill).toMatch(/DFW|Central/);
  });
});
