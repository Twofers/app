import { describe, expect, it } from "vitest";

import {
  isActiveAdGenerationJobStatus,
  isTerminalAdGenerationJobStatus,
  nextRecoverableAdGenerationStage,
  ownerVisibleAdGenerationStage,
  shouldDisableDraftDealForJob,
} from "./ad-generation-job-state";

describe("ad generation job state", () => {
  it("separates active and terminal statuses", () => {
    expect(isActiveAdGenerationJobStatus("queued")).toBe(true);
    expect(isActiveAdGenerationJobStatus("running")).toBe(true);
    expect(isTerminalAdGenerationJobStatus("ready")).toBe(true);
    expect(isTerminalAdGenerationJobStatus("failed")).toBe(true);
    expect(isTerminalAdGenerationJobStatus("canceled")).toBe(true);
  });

  it("disables Draft Deal while a job is active", () => {
    expect(shouldDisableDraftDealForJob(null)).toBe(false);
    expect(shouldDisableDraftDealForJob({ status: "queued", stage: "queued" })).toBe(true);
    expect(shouldDisableDraftDealForJob({ status: "running", stage: "writing_ad" })).toBe(true);
    expect(shouldDisableDraftDealForJob({ status: "ready", stage: "ready" })).toBe(false);
  });

  it("maps real pipeline stages to owner-facing labels", () => {
    expect(ownerVisibleAdGenerationStage({ status: "running", stage: "reading_deal" })).toMatchObject({
      stage: "reading_deal",
      label: "Reading the deal",
      active: true,
      terminal: false,
    });
    expect(ownerVisibleAdGenerationStage({ status: "running", stage: "finding_photo" })).toMatchObject({
      label: "Finding the best photo",
    });
    expect(ownerVisibleAdGenerationStage({ status: "running", stage: "writing_ad" })).toMatchObject({
      label: "Writing the ad",
    });
    expect(ownerVisibleAdGenerationStage({ status: "running", stage: "final_review" })).toMatchObject({
      label: "Giving it one last look",
    });
  });

  it("shows Creating a visual only for the strict generated fallback path", () => {
    expect(ownerVisibleAdGenerationStage({ status: "running", stage: "creating_visual" })).toMatchObject({
      stage: "finding_photo",
      label: "Finding the best photo",
    });
    expect(
      ownerVisibleAdGenerationStage({
        status: "running",
        stage: "creating_visual",
        generatedFallbackReason: "NO_ELIGIBLE_MEDIA",
      }),
    ).toMatchObject({
      stage: "creating_visual",
      label: "Creating a visual",
    });
  });

  it("uses terminal labels when the job has ended", () => {
    expect(ownerVisibleAdGenerationStage({ status: "ready", stage: "final_review" })).toMatchObject({
      stage: "final_review",
      label: "Ready to review",
      active: false,
      terminal: true,
    });
    expect(ownerVisibleAdGenerationStage({ status: "failed", stage: "writing_ad" })).toMatchObject({
      label: "Generation failed",
      terminal: true,
    });
  });

  it("marks failed and canceled jobs as recoverable from queued", () => {
    expect(nextRecoverableAdGenerationStage("failed")).toBe("queued");
    expect(nextRecoverableAdGenerationStage("canceled")).toBe("queued");
    expect(nextRecoverableAdGenerationStage("writing_ad")).toBe("writing_ad");
    expect(nextRecoverableAdGenerationStage("ready")).toBeNull();
  });
});
