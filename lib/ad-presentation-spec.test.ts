import { describe, expect, it } from "vitest";

import {
  AD_COMPOSED_CARD_RENDERER_VERSION,
  AD_PRESENTATION_SPEC_VERSION,
  buildDefaultAdPresentationSpec,
  validateAdPresentationSpec,
} from "./ad-presentation-spec";

describe("ad presentation spec", () => {
  it("creates a bounded default spec for a merchant image", () => {
    const spec = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      focalPoint: { x: 1.4, y: -0.2 },
      crop: { x: 0.1, y: 0.2, width: 2, height: 0.6 },
    });

    expect(spec.specVersion).toBe(AD_PRESENTATION_SPEC_VERSION);
    expect(spec.rendererVersion).toBe(AD_COMPOSED_CARD_RENDERER_VERSION);
    expect(spec.templateId).toBe("split_offer_panel");
    expect(spec.focalPoint).toEqual({ x: 1, y: 0 });
    expect(spec.crop).toEqual({ x: 0.1, y: 0.2, width: 0.9, height: 0.6 });
    expect(validateAdPresentationSpec(spec)).toEqual({ valid: true, reasonCodes: [] });
  });

  it("uses the split panel as the deterministic fallback template", () => {
    const spec = buildDefaultAdPresentationSpec({});

    expect(spec.templateId).toBe("split_offer_panel");
    expect(spec.imageSourceType).toBe("deterministic_fallback");
    expect(spec.textPanel).toBe("solid_bottom");
    expect(validateAdPresentationSpec(spec).valid).toBe(true);
  });

  it("accepts bounded locale presentation overrides", () => {
    const spec = buildDefaultAdPresentationSpec({
      imageAssetId: "deal-photos/cedar-latte.png",
      imageSourceType: "merchant_original",
      templateId: "hero_image_overlay",
      localeOverrides: {
        "es-US": {
          templateId: "split_offer_panel",
          textPanel: "solid_bottom",
          showSupportingCopy: false,
          resolutionReasonCodes: ["LONG_SPANISH_COPY_SAFE_SPLIT", "LONG_SPANISH_COPY_SAFE_SPLIT"],
        },
      },
    });

    expect(spec.localeOverrides?.["es-US"]).toEqual({
      templateId: "split_offer_panel",
      textPanel: "solid_bottom",
      showSupportingCopy: false,
      resolutionReasonCodes: ["LONG_SPANISH_COPY_SAFE_SPLIT"],
    });
    expect(validateAdPresentationSpec(spec)).toEqual({ valid: true, reasonCodes: [] });
  });

  it("fails closed on invalid locale override reason codes", () => {
    const spec = {
      ...buildDefaultAdPresentationSpec({
        imageAssetId: "deal-photos/cedar-latte.png",
        imageSourceType: "merchant_original",
      }),
      localeOverrides: {
        "es-US": {
          templateId: "split_offer_panel",
          textPanel: "solid_bottom",
          showSupportingCopy: false,
          resolutionReasonCodes: ["LONG_SPANISH_COPY_SAFE_SPLIT", 123],
        },
      },
    };

    expect(validateAdPresentationSpec(spec).reasonCodes).toContain("INVALID_LOCALE_OVERRIDE_REASONS");
  });

  it("fails closed on unsupported template values", () => {
    const spec = {
      ...buildDefaultAdPresentationSpec({ imageAssetId: "asset" }),
      templateId: "freeform_css_from_model",
    };

    expect(validateAdPresentationSpec(spec)).toEqual({
      valid: false,
      reasonCodes: ["UNSUPPORTED_TEMPLATE"],
    });
  });
});
