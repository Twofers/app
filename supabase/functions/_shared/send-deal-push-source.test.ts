import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "send-deal-push", "index.ts"),
  "utf8",
);

function functionBlock(name: string): string {
  const start = source.indexOf(`function ${name}`);
  expect(start).toBeGreaterThan(-1);

  const bodyStart = source.indexOf("{", start);
  expect(bodyStart).toBeGreaterThan(start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
}

describe("send-deal-push multilingual rollout source guards", () => {
  it("builds per-recipient viewer-language push copy without model calls", () => {
    expect(source).toMatch(/buildDealReleasePushCopy/);
    expect(source).toMatch(/fetchProfileLocaleByUserId/);
    expect(source).toMatch(/sendExpoPushMessages/);

    expect(source).not.toMatch(/generateStructuredText/);
    expect(source).not.toMatch(/ai-translate-deal/);
    expect(source).not.toMatch(/reviewAdLocalizationSemanticQa/);
    expect(source).not.toMatch(/customer_deal_localizations/);
    expect(source).not.toMatch(/localization_bundle/);
    expect(source).not.toMatch(/operation:\s*"translation"/);
  });

  it("uses recipient profile locale and sends individualized Expo messages", () => {
    const block = functionBlock("sendDealPushToAudience");

    expect(block).toMatch(/\.select\("user_id,expo_push_token"\)/);
    expect(block).toMatch(/fetchProfileLocaleByUserId/);
    expect(block).toMatch(/buildDealReleasePushCopy/);
    expect(block).toMatch(/localeByUserId\.get\(userId\) \?\? "en-US"/);
    expect(block).toMatch(/sendExpoPushMessages/);
    expect(block).not.toMatch(/sendExpoPushBatch/);
    expect(block).not.toMatch(/getDealDisplayTitle/);
  });

  it("schedules upcoming deals and sends only due live release pushes", () => {
    expect(source).toMatch(/resolveDealReleaseNotificationState/);
    expect(source).toMatch(/dealReleaseScheduledFor/);
    expect(source).toMatch(/reserveDealPushEvent/);
    expect(source).toMatch(/deal_push_events/);
    expect(source).toMatch(/dispatch_due/);
    expect(source).toMatch(/isCronAuthorized/);

    const dueBlock = functionBlock("dispatchDueDealPushes");
    expect(dueBlock).toMatch(/\.eq\("send_status", "pending"\)/);
    expect(dueBlock).toMatch(/\.lte\("scheduled_for", nowIso\)/);
    expect(dueBlock).toMatch(/state !== "live"/);
    expect(dueBlock).toMatch(/sendDealPushToAudience/);
  });
});
