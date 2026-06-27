import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "components", "poster", "AdPosterCanvas.tsx"), "utf8");
const templates = readFileSync(join(process.cwd(), "components", "poster", "posterTemplates.ts"), "utf8");

describe("AdPosterCanvas source contract", () => {
  it("keeps the production poster at 4:5", () => {
    expect(source).toContain("POSTER_CANVAS_WIDTH = 1080");
    expect(source).toContain("POSTER_CANVAS_HEIGHT = 1350");
    expect(source).toContain("aspectRatio: POSTER_CANVAS_WIDTH / POSTER_CANVAS_HEIGHT");
  });

  it("keeps visible poster text centered and policy-sanitized", () => {
    expect(source).toContain("sanitizePosterCopy");
    expect(source).toContain("assertPosterCopyPolicy");
    expect(source).toContain('textAlign: "center"');
    expect(source).not.toMatch(/Claim|Redeem|Only \d+ available|timeLabel|scarcity/i);
  });

  it("exposes only production poster templates", () => {
    expect(templates).toContain('["fresh", "bold", "premium"]');
    expect(templates).not.toMatch(/sunrise|macro/i);
  });
});
