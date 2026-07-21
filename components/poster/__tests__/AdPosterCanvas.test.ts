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

  it("keeps the production poster composed as full-bleed templates", () => {
    expect(source).toContain("function PosterBackground");
    expect(source).toContain("ImageBackground");
    expect(source).toContain("TopCopyBlock");
    expect(source).toContain("OfferBlock");
    expect(source).toContain("POSTER_TOP_BAND_HEIGHT = 330");
    expect(source).toContain("POSTER_BOTTOM_BAND_TOP = 888");
    expect(source).toContain("POSTER_HERO_TEXT_SIZE = 72");
    expect(source).toContain("POSTER_OFFER_TEXT_SIZE = 58");
    expect(source).toContain("liveScheduleLabel");
    expect(source).toContain("eyebrowLabel");
    expect(source).toContain("copy.subline || eyebrowLabel");
    // F-024: generic AI kickers the prompt forbids ("Try our", "Our deal",
    // "Special offer", "Menu pick") are blanked deterministically at render so
    // they never stack over the headline as "TRY OUR ANY MUFFIN".
    expect(source).toContain("function sanitizedPosterEyebrow");
    expect(
      source.split("sanitizedPosterEyebrow(posterText(copy.subline || eyebrowLabel))").length - 1,
    ).toBeGreaterThanOrEqual(2);
    expect(source).toContain('"TRY OUR"');
    expect(source).toContain("posterText(copy.offer_line_1)");
    // S2: neither slot may borrow the other — see lib/poster-canvas-source.test.ts. Pinned
    // in both variants because the duplicate had to be removed from V1 and V2 alike.
    expect(source).toContain("posterText(copy.offer_line_2)");
    expect(source).not.toContain("copy.offer_line_2 || copy.headline");
    expect(source).not.toContain("copy.headline || copy.offer_line_2");
    expect(source).toContain("secondaryCandidate === posterText(copy.headline)");
    expect(source).not.toContain("samePosterLine");
    expect(source).not.toContain("badgeTop");
    expect(source).not.toContain("badgeTextColor");
    expect(source).not.toContain("premiumFooterTop");
    expect(source).not.toContain("function initials");
    expect(source).not.toContain("OfferPanel");
  });

  // R1: what bounds headline contrast over a bright photo is the scrim's REACH, not its
  // target luminance. topScrim is sized for y=0, but every text block sits lower — the
  // headline occupies 0.110-0.236 of the canvas, right at the end of the 330/1350 top band.
  // If the gradient is spent before then, retuning POSTER_SCRIM_TARGET_LUMA cannot rescue
  // it: alpha saturates at 1 - target/luma, so 0.20 -> 0.18 measured +0.07 on a real S10
  // render while the reach fix measured +0.98. These guard the reach.
  it("holds the top scrim across the band the copy occupies", () => {
    const locations = /locations=\{\[([\d., ]+)\]\}/.exec(source)?.[1];
    const [start, mid, end] = String(locations).split(",").map((n) => Number(n.trim()));
    expect(start).toBe(0);
    // Headline bottom is (148 + 170) / 1350 = 0.236. The scrim must not be fully gone by then.
    expect(end).toBeGreaterThan(0.236);
    // …and must still be near full strength at the headline's top edge (148 / 1350 = 0.110).
    expect(mid).toBeGreaterThanOrEqual(0.2);
  });

  it("leaves images darker than the target un-scrimmed", () => {
    // `l > TARGET ? … : 0` is what keeps a dark subject (brisket, espresso) from being
    // darkened further — those cells already measure 7:1 and must not regress. It is also
    // why the reach fix cannot regress any dark cell: below the target no scrim is drawn.
    expect(source).toMatch(/l > POSTER_SCRIM_TARGET_LUMA \? 1 - POSTER_SCRIM_TARGET_LUMA \/ l : 0/);
    expect(source).toContain("POSTER_TOP_SCRIM_FALLBACK");
  });

  it("exposes only production poster templates", () => {
    expect(templates).toContain('["fresh", "bold", "premium"]');
    expect(templates).not.toMatch(/sunrise|macro/i);
  });
});
