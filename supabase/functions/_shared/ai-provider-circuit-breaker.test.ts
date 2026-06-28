import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getCircuitBreakerDecision,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
} from "./ai-provider-circuit-breaker.ts";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260727120000_ai_provider_circuit_breakers.sql"),
  "utf8",
);
const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "ai-provider-circuit-breaker.ts"),
  "utf8",
);

function adminWithRows(rows: Record<string, any>) {
  const fakeAdmin = {
    upserts: [] as Record<string, unknown>[],
    from(_table: string) {
      return {
        select() {
          return this;
        },
        eq(_column: string, _value: string) {
          return this;
        },
        async maybeSingle() {
          return { data: rows.current ?? null, error: null };
        },
        async upsert(row: Record<string, unknown>) {
          rows.current = { ...(rows.current ?? {}), ...row };
          fakeAdmin.upserts.push(row);
          return { error: null };
        },
      };
    },
  };
  return fakeAdmin;
}

describe("ai_provider_circuit_breakers migration", () => {
  it("keeps circuit state service-role only", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.ai_provider_circuit_breakers/i);
    expect(migration).toMatch(/ALTER TABLE public\.ai_provider_circuit_breakers ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL ON public\.ai_provider_circuit_breakers FROM anon, authenticated/i);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.ai_provider_circuit_breakers TO service_role/i);
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+ai_provider_circuit_breakers/i);
  });
});

describe("ai provider circuit breaker helper", () => {
  it("does not log raw circuit-breaker storage exception text", () => {
    expect(source).toMatch(/CIRCUIT_BREAKER_DECISION_FAILED/);
    expect(source).toMatch(/CIRCUIT_BREAKER_SUCCESS_RECORD_FAILED/);
    expect(source).toMatch(/CIRCUIT_BREAKER_FAILURE_RECORD_FAILED/);
    expect(source).not.toMatch(/err:\s*String\(error\)\.slice/);
  });

  it("opens for quota failures and blocks until disabled_until", async () => {
    const rows: Record<string, any> = {};
    const fakeAdmin = adminWithRows(rows);
    const now = new Date("2026-06-22T10:00:00.000Z");

    await recordCircuitBreakerFailure({
      admin: fakeAdmin,
      provider: "openai",
      capability: "text_generation",
      errorClass: "quota_exhausted",
      now,
    });

    expect(rows.current.state).toBe("open");
    expect(rows.current.disabled_until).toBe("2026-06-22T10:30:00.000Z");

    const decision = await getCircuitBreakerDecision({
      admin: fakeAdmin,
      provider: "openai",
      capability: "text_generation",
      now: new Date("2026-06-22T10:05:00.000Z"),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.state).toBe("open");
  });

  it("closes after a successful probe", async () => {
    const rows: Record<string, any> = {
      current: {
        provider: "openai",
        capability: "text_generation",
        state: "open",
        failure_count: 3,
        last_error_class: "server_error",
        opened_at: "2026-06-22T10:00:00.000Z",
        disabled_until: "2026-06-22T10:02:00.000Z",
        last_probe_at: null,
        updated_at: "2026-06-22T10:00:00.000Z",
      },
    };
    const fakeAdmin = adminWithRows(rows);

    const decision = await getCircuitBreakerDecision({
      admin: fakeAdmin,
      provider: "openai",
      capability: "text_generation",
      now: new Date("2026-06-22T10:03:00.000Z"),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.probe).toBe(true);

    await recordCircuitBreakerSuccess({
      admin: fakeAdmin,
      provider: "openai",
      capability: "text_generation",
      now: new Date("2026-06-22T10:03:05.000Z"),
    });
    expect(rows.current.state).toBe("closed");
    expect(rows.current.failure_count).toBe(0);
  });
});
