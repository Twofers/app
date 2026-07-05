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
    expect(output).toContain("| es-US | Juan | native_reviewer_signed_off | passed | 3/3 | n/a | Allowed |");
    expect(output).toContain("| ko-KR | June | native_reviewer_signed_off | passed | 3/3 | 3/3 | Allowed |");
    expect(output).toContain("- es-US: none");
    expect(output).toContain("- ko-KR: none");
    expect(output).toContain("## Native Acceptance Packet");
    expect(output).toContain("- Scenario rows: 23/23");
    expect(output).toContain("- Reviewer questions: 8/8");
    expect(output).toContain("- No-secret screenshot rule: yes");
    expect(output).toContain("- Customer no-model-call rule: yes");
    expect(output).toContain("| localization_source_locale | yes | source-locale publish mix |");
    expect(output).toContain("| localization_approval_hash | yes | exact approval coverage |");
    expect(output).toContain("Reviewer sign-off recorded for Spanish and Korean localization gates.");
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
