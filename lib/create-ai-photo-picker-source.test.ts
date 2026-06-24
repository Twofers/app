import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const createAiSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const pickerStart = createAiSource.indexOf("async function pickPhotoFromLibrary()");
const cameraStart = createAiSource.indexOf("async function takePhoto()", pickerStart);
const pickerSource = pickerStart >= 0 && cameraStart > pickerStart
  ? createAiSource.slice(pickerStart, cameraStart)
  : "";

describe("AI ads photo picker source", () => {
  it("opens the image picker without a media-library permission precheck", () => {
    expect(pickerSource).toContain("launchImageLibraryAsync");
    expect(pickerSource).toContain('mediaTypes: ["images"]');
    expect(pickerSource).not.toContain("requestMediaLibraryPermissionsAsync");
  });

  it("makes the no-photo description path visible on the screen", () => {
    expect(createAiSource).toContain("createAi.photoSkipHint");
    expect(createAiSource).toContain("createAi.dealDescriptionHelpNoPhoto");
    expect(createAiSource).toContain("createAi.hintPlaceholderNoPhoto");
  });

  it("uses owner-friendly lower-page workflow labels", () => {
    expect(createAiSource).toContain("createAi.scheduleTitle");
    expect(createAiSource).toContain("createAi.scheduleHelp");
    expect(createAiSource).toContain("createAi.claimSettingsSummary");
    expect(createAiSource).toContain("accessibilityState={{ expanded: claimSettingsOpen }}");
  });
});
