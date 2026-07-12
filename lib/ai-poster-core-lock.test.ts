import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI poster core lock", () => {
  it("keeps the protected AI poster files unchanged without explicit approval", () => {
    execFileSync(process.execPath, ["scripts/check-ai-poster-core-lock.mjs"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  });

  it("runs before the default npm test suite", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.scripts?.pretest).toBe("node scripts/check-ai-poster-core-lock.mjs");
  });
});
