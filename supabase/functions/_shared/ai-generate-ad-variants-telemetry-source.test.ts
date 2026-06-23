import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-generate-ad-variants", "index.ts"),
  "utf8",
);

describe("ai-generate-ad-variants telemetry source guard", () => {
  it("persists total request latency in ad generation log payloads", () => {
    const telemetryIndex = source.indexOf("function buildGenerationTelemetry(");
    const handlerIndex = source.indexOf("Deno.serve(async (req) =>");
    const logIndex = source.indexOf("response_payload: buildGenerationTelemetry({");

    expect(telemetryIndex).toBeGreaterThan(-1);
    expect(handlerIndex).toBeGreaterThan(telemetryIndex);
    expect(logIndex).toBeGreaterThan(handlerIndex);

    const telemetryBlock = source.slice(telemetryIndex, handlerIndex);
    const logBlock = source.slice(logIndex - 300, logIndex + 500);

    expect(source).toMatch(/const requestStartedAtMs = Date\.now\(\)/);
    expect(telemetryBlock).toMatch(/totalLatencyMs:\s*number/);
    expect(telemetryBlock).toMatch(/total_latency_ms:\s*totalLatencyMs/);
    expect(logBlock).toMatch(/totalLatencyMs:\s*Date\.now\(\) - requestStartedAtMs/);
  });

  it("includes elapsed latency when copy generation fails before image work", () => {
    const failureIndex = source.indexOf('failure_reason: "COPY_FAILED"');
    const failureBlock = source.slice(failureIndex, failureIndex + 500);

    expect(failureIndex).toBeGreaterThan(-1);
    expect(failureBlock).toMatch(/total_latency_ms:\s*Date\.now\(\) - requestStartedAtMs/);
  });
});
