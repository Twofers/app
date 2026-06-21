import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("billing trial start ownership", () => {
  it("does not start or extend trials from the business hook", () => {
    const source = readRepoFile("hooks/use-business.ts");
    expect(source).not.toMatch(/30\s*\*\s*86400000/);
    expect(source).not.toMatch(/subscription_status:\s*["']trial["']/);
    expect(source).not.toMatch(/trial_ends_at:\s*String/);
  });

  it("does not seed trial state during business setup", () => {
    const source = readRepoFile("app/business-setup.tsx");
    expect(source).not.toMatch(/trialEndsIso/);
    expect(source).not.toMatch(/subscription_status:\s*["']trial["']/);
    expect(source).not.toMatch(/trial_ends_at/);
  });

  it("does not expose the old no-card owner trial RPC from billing UI", () => {
    const source = readRepoFile("app/(tabs)/billing.tsx");
    expect(source).not.toMatch(/start_location_trial/);
    expect(source).toMatch(/trial_acknowledged/);
  });
});
