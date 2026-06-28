import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const createAiSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const analyticsSource = readFileSync(join(process.cwd(), "lib", "analytics.ts"), "utf8");

describe("composed ad card telemetry source guards", () => {
  it("defines stable composed-card rollout analytics events", () => {
    expect(analyticsSource).toMatch(/COMPOSED_PREVIEW_SHOWN: "ai_ads_composed_preview_shown"/);
    expect(analyticsSource).toMatch(/COMPOSED_STYLE_CHANGED: "ai_ads_composed_style_changed"/);
    expect(analyticsSource).toMatch(/COMPOSED_APPROVED: "ai_ads_composed_approved"/);
    expect(analyticsSource).toMatch(/COMPOSED_APPROVAL_BLOCKED: "ai_ads_composed_approval_blocked"/);
    expect(analyticsSource).toMatch(/COMPOSED_PUBLISH_BLOCKED: "ai_ads_composed_publish_blocked"/);
  });

  it("emits preview, style, approval, and publish-guard metrics from the AI create flow", () => {
    expect(createAiSource).toMatch(/AiAdsEvents\.COMPOSED_PREVIEW_SHOWN/);
    expect(createAiSource).toMatch(/AiAdsEvents\.COMPOSED_STYLE_CHANGED/);
    expect(createAiSource).toMatch(/AiAdsEvents\.COMPOSED_APPROVED/);
    expect(createAiSource).toMatch(/AiAdsEvents\.COMPOSED_APPROVAL_BLOCKED/);
    expect(createAiSource).toMatch(/AiAdsEvents\.COMPOSED_PUBLISH_BLOCKED/);
    expect(createAiSource).toMatch(/selected_template_id/);
    expect(createAiSource).toMatch(/alternate_template_count/);
    expect(createAiSource).toMatch(/merchant_style_override_used/);
    expect(createAiSource).toMatch(/composite_qa_decision/);
    expect(createAiSource).toMatch(/composite_qa_repair_count/);
    expect(createAiSource).toMatch(/time_to_first_preview_ms/);
    expect(createAiSource).toMatch(/time_to_approval_ms/);
  });
});
