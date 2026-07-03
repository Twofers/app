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

  it("renders the offer as a badge plus one item/context line", () => {
    expect(source).toContain("samePosterLine");
    expect(source).toContain("transform: isPremium ? [] : [{ rotate: \"-3deg\" }]");
    expect(source).toContain("const badgeTop = isPremium");
    expect(source).toContain("const itemLine = cleanText(copy.headline) || cleanText(copy.offer_line_2)");
    expect(source).not.toContain("hasEyebrow");
  });

  it("keeps the production poster composed as full-bleed templates", () => {
    expect(source).toContain("function PosterBackground");
    expect(source).toContain("ImageBackground");
    expect(source).toContain("TopCopyBlock");
    expect(source).toContain("OfferBlock");
    expect(source).not.toContain("eyebrowLabel");
    expect(source).not.toContain("function initials");
    expect(source).not.toContain("OfferPanel");
  });

  it("exposes only production poster templates", () => {
    expect(templates).toContain('["fresh", "bold", "premium"]');
    expect(templates).not.toMatch(/sunrise|macro/i);
  });
});
