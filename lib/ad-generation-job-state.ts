import type { AdGenerationJobStage, AdGenerationJobStatus } from "./business-media-library";

export type AdGenerationJobProgress = {
  status: AdGenerationJobStatus;
  stage: AdGenerationJobStage;
  generatedFallbackReason?: "NO_ELIGIBLE_MEDIA" | null;
};

export type AdGenerationVisibleStage = {
  stage: AdGenerationJobStage;
  label:
    | "Reading the deal"
    | "Finding the best photo"
    | "Creating a visual"
    | "Writing the ad"
    | "Building the design"
    | "Giving it one last look"
    | "Ready to review"
    | "Generation failed"
    | "Canceled";
  active: boolean;
  terminal: boolean;
};

const STAGE_LABELS: Record<AdGenerationJobStage, AdGenerationVisibleStage["label"]> = {
  queued: "Reading the deal",
  reading_deal: "Reading the deal",
  finding_photo: "Finding the best photo",
  creating_visual: "Creating a visual",
  writing_ad: "Writing the ad",
  building_design: "Building the design",
  final_review: "Giving it one last look",
  ready: "Ready to review",
  failed: "Generation failed",
  canceled: "Canceled",
};

export function isTerminalAdGenerationJobStatus(status: AdGenerationJobStatus): boolean {
  return status === "ready" || status === "failed" || status === "canceled";
}

export function isActiveAdGenerationJobStatus(status: AdGenerationJobStatus): boolean {
  return !isTerminalAdGenerationJobStatus(status);
}

export function shouldDisableDraftDealForJob(job: AdGenerationJobProgress | null | undefined): boolean {
  return Boolean(job && isActiveAdGenerationJobStatus(job.status));
}

function terminalStageForStatus(status: AdGenerationJobStatus): AdGenerationJobStage {
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  return "queued";
}

export function ownerVisibleAdGenerationStage(job: AdGenerationJobProgress): AdGenerationVisibleStage {
  const generatedVisualStarted =
    job.stage === "creating_visual" && job.generatedFallbackReason === "NO_ELIGIBLE_MEDIA";
  const stage = job.stage === "creating_visual" && !generatedVisualStarted ? "finding_photo" : job.stage;
  const terminal = isTerminalAdGenerationJobStatus(job.status);
  const labelStage = terminal ? terminalStageForStatus(job.status) : stage;

  return {
    stage,
    label: STAGE_LABELS[labelStage],
    active: !terminal,
    terminal,
  };
}

export function nextRecoverableAdGenerationStage(
  stage: AdGenerationJobStage,
): AdGenerationJobStage | null {
  if (stage === "failed" || stage === "canceled") return "queued";
  if (stage === "ready") return null;
  return stage;
}
