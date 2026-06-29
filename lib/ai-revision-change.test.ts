import { describe, expect, it } from "vitest";

import type { GeneratedAd } from "./ad-variants";
import { summarizeAiRevisionChange } from "./ai-revision-change";

function ad(overrides: Partial<GeneratedAd> = {}): GeneratedAd {
  return {
    headline: "Coffee and cookie reward",
    subheadline: "Buy a large coffee and choose a free cookie.",
    short_description: "Buy a large coffee and choose a free cookie.",
    cta: "Claim deal",
    poster_storage_path: "biz/original.jpg",
    photo_source: "generated",
    photo_treatment: null,
    ...overrides,
  };
}

describe("summarizeAiRevisionChange", () => {
  it("rejects copy revisions when visible copy is unchanged", () => {
    const summary = summarizeAiRevisionChange({
      previousAd: ad(),
      revisedAd: ad(),
      target: "copy",
    });

    expect(summary).toEqual({
      copyChanged: false,
      imageChanged: false,
      hasExpectedChange: false,
    });
  });

  it("accepts copy revisions when the visible headline changes", () => {
    expect(summarizeAiRevisionChange({
      previousAd: ad(),
      revisedAd: ad({ headline: "Your coffee run comes with a cookie" }),
      target: "copy",
    }).hasExpectedChange).toBe(true);
  });

  it("does not treat hidden social-caption-only edits as visible copy changes", () => {
    expect(summarizeAiRevisionChange({
      previousAd: ad({ social_caption: "Coffee and cookie reward." }),
      revisedAd: ad({ social_caption: "Your coffee run comes with a cookie." }),
      target: "copy",
    }).hasExpectedChange).toBe(false);
  });

  it("counts poster copy changes as visible copy changes", () => {
    const previousAd = ad({
      poster: {
        version: 1,
        enabled: true,
        template_id: "premium",
        aspect_ratio: "4:5",
        source_asset_path: null,
        rendered_asset_path: null,
        copy: {
          business_name: "Test Cafe",
          headline: "Coffee and cookie reward",
          offer_line_1: "Buy any large coffee",
          offer_line_2: "Get a free cookie",
        },
        copy_by_language: {
          "en-US": {
            business_name: "Test Cafe",
            headline: "Coffee and cookie reward",
            offer_line_1: "Buy any large coffee",
            offer_line_2: "Get a free cookie",
          },
          "es-US": {
            business_name: "Test Cafe",
            headline: "Coffee and cookie reward",
            offer_line_1: "Buy any large coffee",
            offer_line_2: "Get a free cookie",
          },
          "ko-KR": {
            business_name: "Test Cafe",
            headline: "Coffee and cookie reward",
            offer_line_1: "Buy any large coffee",
            offer_line_2: "Get a free cookie",
          },
        },
        layout_policy: {
          text_align: "center",
          safe_area_percent: 8,
          max_lines: {
            business_name: 1,
            headline: 2,
            offer_line_1: 2,
            offer_line_2: 2,
            subline: 1,
          },
        },
        content_policy: {
          no_app_brand_token: true,
          no_cta: true,
          no_scarcity: true,
          no_mutable_live_facts: true,
          image_text_free: true,
        },
        policy: {
          passed: true,
          reasonCodes: [],
          removedTerms: [],
          warnings: [],
        },
      },
    });
    const revisedAd = {
      ...previousAd,
      poster: {
        ...previousAd.poster!,
        copy: {
          ...previousAd.poster!.copy,
          headline: "A better coffee break",
        },
      },
    };

    expect(summarizeAiRevisionChange({
      previousAd,
      revisedAd,
      target: "copy",
    }).copyChanged).toBe(true);
  });

  it("accepts image revisions when the selected image changes", () => {
    expect(summarizeAiRevisionChange({
      previousAd: ad(),
      revisedAd: ad({ poster_storage_path: "biz/revision.jpg" }),
      target: "image",
    }).hasExpectedChange).toBe(true);
  });

  it("allows either visible copy or image change for both-target revisions", () => {
    expect(summarizeAiRevisionChange({
      previousAd: ad(),
      revisedAd: ad({ headline: "Your coffee run comes with a cookie" }),
      target: "both",
    }).hasExpectedChange).toBe(true);
  });
});
