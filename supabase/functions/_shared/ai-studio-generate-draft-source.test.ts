import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "supabase", "functions", "ai-studio-generate-draft", "index.ts"),
  "utf8",
);
const imageProviderSource = readFileSync(
  join(process.cwd(), "supabase", "functions", "_shared", "ai-image-provider.ts"),
  "utf8",
);
const devScreenSource = readFileSync(
  join(process.cwd(), "app", "ai-deal-studio-dev.tsx"),
  "utf8",
);

describe("ai-studio-generate-draft source guard", () => {
  it("requests Gemini images in the same 4:5 ratio used by the native preview", () => {
    expect(imageProviderSource).toMatch(/AiImageAspectRatio = "1:1" \| "4:3" \| "16:9" \| "4:5"/);
    expect(source).toMatch(/aspectRatio:\s*"4:5"/);
  });

  it("keeps image generation copy-only by default but deadline-aware when enabled", () => {
    expect(source).toMatch(/copyOnly:\s*bool\(body\.copy_only,\s*true\)/);
    expect(source).toMatch(/AI_STUDIO_ENABLE_IMAGE_GENERATION/);
    expect(source).toMatch(/createAiImageDeadline/);
    expect(source).toMatch(/AI_STUDIO_IMAGE_REQUEST_DEADLINE_MS/);
    expect(source).toMatch(/firstAttemptLeg:\s*"ai_studio_gemini_image"/);
    expect(source).toMatch(/retryAttemptLeg:\s*"ai_studio_gemini_image_retry"/);
    expect(source).toMatch(/image_deadline:\s*imageResult\.deadlineReport/);
    expect(source).toMatch(/stage_timings_ms:\s*stageTimingsMs/);
  });

  it("keeps the dev draft poster-first and source/rendered asset contract explicit", () => {
    expect(source).toMatch(/kicker:\s*\{\s*type:\s*"string"\s*\}/);
    expect(source).toMatch(/offer_line_1:\s*\{\s*type:\s*"string"\s*\}/);
    expect(source).toMatch(/composition_plan/);
    expect(source).toMatch(/source_asset_path:\s*draft\.image_asset_path/);
    expect(source).toMatch(/rendered_asset_path:\s*null/);
    expect(source).toMatch(/DEFAULT_CTA = ""/);
    expect(source).toMatch(/Never use the word Twofer in any poster field/);
    expect(source).toMatch(/scarcityLabel:\s*""/);
  });

  it("keeps deterministic poster fallback copy offer-aware instead of Try our item echoes", () => {
    expect(source).toContain("posterHeadlineFromOffer");
    expect(source).toContain("posterRewardLabel");
    expect(source).toContain("getFreeMatch");
    expect(source).toContain("isWeakPosterHeadline");
    expect(source).toContain("stripAwkwardAnyDeterminer");
    expect(source).toContain('kicker: "LOCAL DEAL"');
    expect(source).toContain("Never use 'Try our' as the kicker or headline");
    expect(source).toContain("not BUY AN ANY LARGE COFFEE DRINK");
    expect(source).not.toContain('kicker: "TRY OUR"');
    expect(source).not.toContain("`${product} TIME`");

    expect(devScreenSource).toContain("posterHeadlineFromOffer");
    expect(devScreenSource).toContain("getFreeMatch");
    expect(devScreenSource).toContain("safePosterHeadline");
    expect(devScreenSource).toContain("stripAwkwardAnyDeterminer");
    expect(devScreenSource).not.toContain("`${product} TIME`");
  });

  describe("de-food-bias hardening: business-grounded item labels", () => {
    it("derives item labels from the business's own menu items/category when the food lexicon misses", () => {
      expect(source).toContain("PosterGroundingContext");
      expect(source).toContain("matchPosterGroundingMenuItem");
      expect(source).toContain("fetchPosterGroundingContext");
      // The food-word lexicon still wins first; grounding is only consulted
      // after it misses, and the raw word-position guess is the last resort.
      const labelFnIndex = source.indexOf("function posterItemLabel(");
      expect(labelFnIndex).toBeGreaterThan(-1);
      const labelFnBlock = source.slice(labelFnIndex, labelFnIndex + 1000);
      const knownIndex = labelFnBlock.indexOf("POSTER_ITEM_WORDS.find");
      const groundedIndex = labelFnBlock.indexOf("matchPosterGroundingMenuItem(");
      const lastResortIndex = labelFnBlock.indexOf("words.slice(0, 2).join");
      expect(knownIndex).toBeGreaterThan(-1);
      expect(groundedIndex).toBeGreaterThan(knownIndex);
      expect(lastResortIndex).toBeGreaterThan(groundedIndex);
    });

    it("threads the optional grounding context through the poster label call chain without changing default (no-context) behavior", () => {
      expect(source).toMatch(/function posterItemLabel\(value: string \| null \| undefined, context\?: PosterGroundingContext\)/);
      expect(source).toMatch(/function productKeyword\(productName: string, context\?: PosterGroundingContext\)/);
      expect(source).toMatch(/function posterRewardLabel\(offerTerms: string, productName: string, context\?: PosterGroundingContext\)/);
      expect(source).toMatch(/function posterHeadlineFromOffer\(productName: string, offerTerms: string, context\?: PosterGroundingContext\)/);
    });

    it("fetches grounding context best-effort (a lookup failure never blocks draft generation)", () => {
      const fetchFnIndex = source.indexOf("async function fetchPosterGroundingContext(");
      expect(fetchFnIndex).toBeGreaterThan(-1);
      const fetchFnBlock = source.slice(fetchFnIndex, fetchFnIndex + 1000);
      expect(fetchFnBlock).toMatch(/try \{/);
      expect(fetchFnBlock).toMatch(/\} catch \{/);
      expect(fetchFnBlock).toContain("business_menu_items");
    });
  });

  describe("de-food-bias hardening: banned generic headlines", () => {
    it("extends isWeakPosterHeadline with a banned-generic-copy list", () => {
      expect(source).toContain("POSTER_BANNED_GENERIC_HEADLINES");
      expect(source).toContain("isBannedGenericPosterHeadline");
      expect(source).toMatch(/great\\s\+deal/);
      expect(source).toMatch(/amazing\\s\+offer/);
      expect(source).toMatch(/best\\s\+in\\s\+town/);
      expect(source).toMatch(/limited\\s\+time/);

      const weakFnIndex = source.indexOf("function isWeakPosterHeadline(");
      expect(weakFnIndex).toBeGreaterThan(-1);
      const weakFnBlock = source.slice(weakFnIndex, weakFnIndex + 500);
      expect(weakFnBlock).toContain("isBannedGenericPosterHeadline(cleaned)");
    });
  });

  describe("de-food-bias hardening: degraded-field signal", () => {
    it("sanitizePosterCreative reports which poster fields fell back instead of silently substituting", () => {
      const sanitizeFnIndex = source.indexOf("function sanitizePosterCreative(");
      expect(sanitizeFnIndex).toBeGreaterThan(-1);
      const sanitizeFnBlock = source.slice(sanitizeFnIndex, sanitizeFnIndex + 1200);
      expect(sanitizeFnBlock).toContain("degradedFields: PosterDegradedField[]");
      expect(sanitizeFnBlock).toContain('degradedFields.push("kicker")');
      expect(sanitizeFnBlock).toContain('degradedFields.push("headline")');
      expect(sanitizeFnBlock).toContain('degradedFields.push("supportingLine")');
      expect(sanitizeFnBlock).toContain('degradedFields.push("offerLine1")');
      expect(sanitizeFnBlock).toContain('degradedFields.push("offerLine2")');
    });

    it("surfaces degraded + degraded_fields on both the ai_generation_logs payload and the client response", () => {
      const occurrences = source.match(/degraded:\s*degradedFields\.length > 0,\s*\n\s*degraded_fields:\s*degradedFields,/g) ?? [];
      // Once in the ai_generation_logs response_payload, once in the returned draft JSON.
      expect(occurrences.length).toBe(2);
    });

    it("marks the pure dry-run/no-key fallback as degraded up front, then lets a live generation overwrite it with per-field results", () => {
      expect(source).toMatch(/let degradedFields: string\[\] = dryRun \? \["ai_generation_skipped"\] : \[\];/);
      expect(source).toMatch(/degradedFields = generated\.degradedFields;/);
    });
  });
});
