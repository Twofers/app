import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("scheduled-publish confirmation copy", () => {
  it("uses a scheduled message, with a localized time, on the create and dashboard surfaces", () => {
    const create = read("app/create/ai.tsx");
    const dashboard = read("app/(tabs)/dashboard.tsx");
    expect(create).toMatch(/publishScheduledSuccessBody/);
    expect(create).toMatch(/markRecentPublish\(title\.trim\(\), scheduledStartAt\)/);
    expect(dashboard).toMatch(/publishScheduledBanner/);
    expect(dashboard).toMatch(/formatAppDateTime\(recentPublish\.scheduledStartAt, i18n\.language\)/);
  });

  it("provides scheduled confirmation copy in all supported locales", () => {
    for (const locale of ["en", "es", "ko"]) {
      const messages = read(`lib/i18n/locales/${locale}.json`);
      expect(messages).toMatch(/"publishScheduledSuccessBody"/);
      expect(messages).toMatch(/"publishScheduledBanner"/);
    }
  });
});
