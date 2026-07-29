import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20260824131000_harden_legacy_reporting_views.sql",
  ),
  "utf8",
);

describe("legacy reporting view hardening migration", () => {
  it.each(["business_performance_hourly", "deal_stats"])(
    "makes public.%s a security-invoker, service-role-only view",
    (view) => {
      expect(migration).toMatch(
        new RegExp(
          `CREATE OR REPLACE VIEW public\\.${view}[\\s\\S]*?WITH \\(security_invoker = true, security_barrier = true\\)`,
          "i",
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `REVOKE ALL ON TABLE public\\.${view}\\s+FROM PUBLIC, anon, authenticated`,
          "i",
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `GRANT SELECT ON TABLE public\\.${view} TO service_role`,
          "i",
        ),
      );
    },
  );

  it("does not restore direct client grants", () => {
    expect(migration).not.toMatch(
      /GRANT\s+\w+(?:\s*,\s*\w+)*\s+ON TABLE public\.(?:business_performance_hourly|deal_stats)\s+TO\s+(?:PUBLIC|anon|authenticated)/i,
    );
  });
});
