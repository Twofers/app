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
});
