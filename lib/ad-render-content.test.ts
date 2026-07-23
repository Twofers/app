import { describe, expect, it } from "vitest";
import type { GeneratedAd } from "./ad-variants";
import { imageSourceTypeFromGeneratedAd } from "./ad-render-content";
import { buildImageAssetLineage } from "./image-asset-lineage";

describe("imageSourceTypeFromGeneratedAd", () => {
  it("treats nested selected generated image paths as usable AI images", () => {
    const ad = {
      headline: "Coffee + cookie break",
      subheadline: "Free cookie with The Sergeant's Stripes.",
      cta: "Claim deal",
      poster_storage_path: null,
      photo_source: "generated",
      image_selection: {
        sourceMode: "ai_generated",
        editMode: "none",
        sourcePhotoPath: null,
        selectedStoragePath: "business/ai_ad_gemini.png",
        merchantSelected: true,
        selectedAt: "2026-07-14T02:00:00.000Z",
        provider: "gemini",
        model: "gemini-3.1-flash-image",
        promptVersion: "image_prompt_v3",
        qa: {
          checked: true,
          sourceType: "ai_generated",
          decision: "pass",
          hardFailReasons: [],
          warningCodes: [],
          missingItems: [],
          unavailable: false,
          merchantOverrideAllowed: false,
          merchantOverrideAcknowledged: false,
        },
        lineage: buildImageAssetLineage({
          sourceMode: "ai_generated",
          editMode: "none",
          sourceStoragePath: null,
          outputStoragePath: "business/ai_ad_gemini.png",
          provider: "gemini",
          model: "gemini-3.1-flash-image",
          promptVersion: "image_prompt_v3",
        }),
      },
    } satisfies GeneratedAd;

    expect(imageSourceTypeFromGeneratedAd(ad)).toBe("ai_generated");
  });
});
