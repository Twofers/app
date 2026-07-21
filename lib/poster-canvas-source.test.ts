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

  it("renders the poster in the classic stacked ad layout", () => {
    expect(source).toContain("POSTER_TOP_BAND_HEIGHT = 330");
    expect(source).toContain("POSTER_BOTTOM_BAND_TOP = 888");
    expect(source).toContain("POSTER_HERO_TEXT_SIZE = 72");
    expect(source).toContain("POSTER_OFFER_TEXT_SIZE = 58");
    expect(source).toContain("liveScheduleLabel");
    expect(source).toContain("eyebrowLabel");
    expect(source).toContain("copy.subline || eyebrowLabel");
    expect(source).toContain("posterText(copy.offer_line_1)");
    // S2: neither slot may borrow the other. The hero used to fall back to offer_line_2 and
    // the secondary used to fall back to the headline, so a non-English poster — which has
    // no translated hero — printed the same sentence twice in two type sizes.
    expect(source).toContain("posterText(copy.offer_line_2)");
    expect(source).not.toContain("copy.offer_line_2 || copy.headline");
    expect(source).not.toContain("copy.headline || copy.offer_line_2");
    expect(source).toContain("secondaryCandidate === posterText(copy.headline)");
    expect(source).not.toContain("samePosterLine");
    expect(source).not.toContain("badgeTop");
    expect(source).not.toContain("badgeTextColor");
    expect(source).not.toContain("premiumFooterTop");
  });

  it("keeps the production poster composed as full-bleed templates", () => {
    expect(source).toContain("function PosterBackground");
    expect(source).toContain("ImageBackground");
    expect(source).toContain("TopCopyBlock");
    expect(source).toContain("OfferBlock");
    expect(source).toContain("eyebrowLabel");
    expect(source).not.toContain("function initials");
    expect(source).not.toContain("OfferPanel");
  });

  it("exposes only production poster templates", () => {
    expect(templates).toContain('["fresh", "bold", "premium"]');
    expect(templates).not.toMatch(/sunrise|macro/i);
  });
});
