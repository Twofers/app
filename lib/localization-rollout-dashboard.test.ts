import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("localization rollout dashboard", () => {
  it("prints a local readiness dashboard with reviewer blockers and publish telemetry coverage", () => {
    const output = execFileSync(process.execPath, ["scripts/generate-localization-rollout-dashboard.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("# Localization Rollout Dashboard");
    expect(output).toContain("Rollout gate version: localization-rollout-gate-v1");
    expect(output).toContain("| es-US | TBD | native_reviewer_tbd | pending | 0/3 | n/a | Blocked |");
    expect(output).toContain("| ko-KR | TBD | native_reviewer_tbd | pending | 0/3 | 0/3 | Blocked |");
    expect(output).toContain("NATIVE_REVIEWER_TBD");
    expect(output).toContain("REAL_DEVICE_SCREENSHOT_QA_PENDING");
    expect(output).toContain("KOREAN_COUNTER_NATIVE_REVIEW_PENDING");
    expect(output).toContain("| localization_source_locale | yes | source-locale publish mix |");
    expect(output).toContain("| localization_approval_hash | yes | exact approval coverage |");
  });

  it("is exposed as an npm script for rollout review", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["dashboard:localization-rollout"]).toBe(
      "node scripts/generate-localization-rollout-dashboard.mjs",
    );
  });
});
