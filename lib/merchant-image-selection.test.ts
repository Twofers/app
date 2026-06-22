import { describe, expect, it } from "vitest";

import {
  buildAdImageSelection,
  canPublishAdImageSelection,
  imageEditModeFromPhotoTreatment,
  imageSourceModeFromPhotoSource,
  photoTreatmentFromImageEditMode,
} from "./merchant-image-selection";

const passQa = {
  checked: true,
  sourceType: "merchant_ai_edit" as const,
  decision: "pass" as const,
  hardFailReasons: [],
  warningCodes: [],
  missingItems: [],
  unavailable: false,
  merchantOverrideAllowed: false,
  merchantOverrideAcknowledged: false,
};

describe("merchant image selection", () => {
  it("maps legacy photo source and treatment fields into canonical modes", () => {
    expect(imageSourceModeFromPhotoSource("uploaded_original")).toBe("merchant_original");
    expect(imageSourceModeFromPhotoSource("uploaded_enhanced")).toBe("merchant_ai_edit");
    expect(imageSourceModeFromPhotoSource("stock")).toBe("approved_stock");
    expect(imageSourceModeFromPhotoSource("copy_only")).toBe("deterministic_fallback");
    expect(imageEditModeFromPhotoTreatment("cleanbg")).toBe("clean_background");
    expect(photoTreatmentFromImageEditMode("studio_polish")).toBe("studiopolish");
  });

  it("builds lineage for an AI-edited derivative", () => {
    const selection = buildAdImageSelection({
      photoSource: "uploaded_enhanced",
      editMode: "studio_polish",
      sourcePhotoPath: "biz/original.jpg",
      selectedStoragePath: "biz/edited.png",
      provider: "gemini",
      model: "gemini-2.5-flash-image",
      promptVersion: "image_prompt_v3",
      qa: passQa,
    });

    expect(selection.sourceMode).toBe("merchant_ai_edit");
    expect(selection.lineage.derivative).toBe(true);
    expect(selection.lineage.sourceAssetId).toBe("deal-photos:biz/original.jpg");
    expect(selection.lineage.outputAssetId).toBe("deal-photos:biz/edited.png");
    expect(canPublishAdImageSelection(selection)).toBe(true);
  });

  it("requires acknowledgement for overrideable merchant-original warnings", () => {
    const selection = buildAdImageSelection({
      photoSource: "uploaded_original",
      selectedStoragePath: "biz/original.jpg",
      qa: {
        checked: false,
        sourceType: "merchant_original",
        decision: "unavailable",
        hardFailReasons: [],
        warningCodes: ["VISION_QA_UNAVAILABLE"],
        missingItems: [],
        unavailable: true,
        merchantOverrideAllowed: true,
        merchantOverrideAcknowledged: false,
      },
    });

    expect(canPublishAdImageSelection(selection)).toBe(false);
    expect(
      canPublishAdImageSelection({
        ...selection,
        qa: { ...selection.qa, merchantOverrideAcknowledged: true },
      }),
    ).toBe(true);
  });
});
