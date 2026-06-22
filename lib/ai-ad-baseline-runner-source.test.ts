import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "scripts", "measure-ai-ad-baseline.mjs"),
  "utf8",
);

describe("AI ad baseline metrics runner source", () => {
  it("surfaces provider fallback, judge, and image QA dashboard metrics", () => {
    expect(source).toMatch(/copy_provider_attempts/);
    expect(source).toMatch(/provider_fallback_reasons/);
    expect(source).toMatch(/candidate_judge/);
    expect(source).toMatch(/Judge skipped reasons/);
    expect(source).toMatch(/image_qa/);
    expect(source).toMatch(/Merchant override acknowledgement rate/);
    expect(source).toMatch(/selection_source_mode_counts/);
  });
});
