import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("localization plan completion audit", () => {
  it("passes the local plan completion audit gate", () => {
    const output = execFileSync(process.execPath, ["scripts/check-localization-plan-completion.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Localization plan completion audit checks passed.");
    expect(output).toContain("PASS completion blockers are explicit");
    expect(output).toContain("PASS rollout gate still blocks broad Spanish and Korean production");
  });

  it("is exposed as an npm script for plan review", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["gate:localization-plan"]).toBe(
      "node scripts/check-localization-plan-completion.mjs",
    );
  });
});
