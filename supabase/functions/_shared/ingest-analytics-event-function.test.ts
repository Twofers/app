import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ingest-analytics-event", "index.ts"),
  "utf8",
);

describe("ingest-analytics-event edge function", () => {
  it("allows AI ad quality and versioned publish telemetry events", () => {
    expect(source).toMatch(/ai_ad_quality_gate_failed/);
    expect(source).toMatch(/ai_ad_versioned_publish/);
    expect(source).toMatch(/quick_deal_offer_definition_fallback_used/);
  });
});
