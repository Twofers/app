import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const createAiSource = readFileSync(join(process.cwd(), "app", "create", "ai.tsx"), "utf8");
const pickerStart = createAiSource.indexOf("async function pickPhotoFromLibrary()");
const cameraStart = createAiSource.indexOf("async function takePhoto()", pickerStart);
const pickerSource = pickerStart >= 0 && cameraStart > pickerStart
  ? createAiSource.slice(pickerStart, cameraStart)
  : "";
const captureStart = createAiSource.indexOf("async function capturePhoto()", cameraStart);
const recordingStart = createAiSource.indexOf("async function startRecording()", captureStart);
const captureSource = captureStart >= 0 && recordingStart > captureStart
  ? createAiSource.slice(captureStart, recordingStart)
  : "";

describe("AI ads photo picker source", () => {
  it("opens the image picker without a media-library permission precheck", () => {
    expect(pickerSource).toContain("launchImageLibraryAsync");
    expect(pickerSource).toContain('mediaTypes: ["images"]');
    expect(pickerSource).not.toContain("requestMediaLibraryPermissionsAsync");
  });

  it("leaves deal photo compression to the shared upload helper", () => {
    expect(pickerSource).toContain("quality: 1");
    expect(captureSource).toContain("takePictureAsync({ quality: 1 })");
  });

  it("routes create-screen deal photo uploads through the shared uploader", () => {
    expect(createAiSource).toContain('import { uploadDealPhoto } from "../../lib/upload-deal-photo";');
    expect(createAiSource.match(/uploadDealPhoto\(businessId,/g)).toHaveLength(2);
    expect(createAiSource).not.toContain('.from("deal-photos").upload');
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
