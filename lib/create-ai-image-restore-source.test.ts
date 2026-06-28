import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "app", "create", "ai.tsx"),
  "utf8",
);

describe("AI create image compare and restore source guards", () => {
  it("keeps original/current comparison and earlier image restore controls", () => {
    expect(source).toMatch(/type ImageVersionEntry/);
    expect(source).toMatch(/const \[imageVersions, setImageVersions\]/);
    expect(source).toMatch(/function buildOriginalPhotoVersionAd/);
    expect(source).toMatch(/function restoreImageVersion/);
    expect(source).toMatch(/createAi\.imageCompareTitle/);
    expect(source).toMatch(/createAi\.imageRestoreOriginal/);
    expect(source).toMatch(/createAi\.imageVersionsTitle/);
  });

  it("invalidates prior approval when an image version is restored", () => {
    const restoreIndex = source.indexOf("function restoreImageVersion");
    const resetIndex = source.indexOf("function resetGenerationState");
    expect(restoreIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeGreaterThan(restoreIndex);

    const restoreBlock = source.slice(restoreIndex, resetIndex);
    expect(restoreBlock).toMatch(/setGeneratedAd\(restored\)/);
    expect(restoreBlock).toMatch(/setAdAccepted\(false\)/);
    expect(restoreBlock).toMatch(/setPublishStatus\("idle"\)/);
    expect(restoreBlock).toMatch(/aiDraftBaselineRef\.current = null/);
  });

  it("exposes bounded custom image edit input and sends it to ad generation", () => {
    expect(source).toMatch(/const \[useCustomImageEdit, setUseCustomImageEdit\]/);
    expect(source).toMatch(/const \[customImageEditInstruction, setCustomImageEditInstruction\]/);
    expect(source).toMatch(/createAi\.treatmentCustomLabel/);
    expect(source).toMatch(/createAi\.customImageEditPlaceholder/);
    expect(source).toMatch(/createAi\.errCustomImageEditRequired/);
    expect(source).toMatch(/sentEditMode === "custom"/);
    expect(source).toMatch(/custom_image_edit_instruction: customEditText/);
  });

  it("requires explicit acknowledgement before publishing an original merchant photo", () => {
    expect(source).toMatch(/const \[merchantOriginalWarningAcknowledged, setMerchantOriginalWarningAcknowledged\]/);
    expect(source).toMatch(/accessibilityRole="checkbox"/);
    expect(source).toMatch(/createAi\.originalPhotoAckLabel/);
    expect(source).toMatch(/createAi\.errOriginalPhotoAckRequired/);
    expect(source).toMatch(/usePhotoAsFinal && !merchantOriginalWarningAcknowledged/);
    expect(source).toMatch(/originalPhotoSelectionQa\(params\.merchantOriginalWarningAcknowledged\)/);
    expect(source).toMatch(/originalPhotoSelectionQa\(false\)/);
  });
});
