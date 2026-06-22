import { buildImageAssetLineage, type ImageAssetLineage } from "./image-asset-lineage.ts";

export type MerchantImageSourceMode =
  | "merchant_original"
  | "merchant_ai_edit"
  | "ai_generated"
  | "approved_stock"
  | "deterministic_fallback";

export type MerchantImageEditMode =
  | "none"
  | "touchup"
  | "clean_background"
  | "studio_polish"
  | "custom";

export type MerchantPhotoTreatment = "touchup" | "cleanbg" | "studiopolish";

export type ProducedPhotoSource =
  | "uploaded_original"
  | "uploaded_enhanced"
  | "generated"
  | "stock"
  | "copy_only"
  | "fallback_template";

export type MerchantImageQaDecision = "pass" | "warn" | "block" | "unavailable" | "not_checked";

export type AdImageSelectionQa = {
  checked: boolean;
  sourceType: MerchantImageSourceMode;
  decision: MerchantImageQaDecision;
  hardFailReasons: string[];
  warningCodes: string[];
  missingItems: string[];
  unavailable: boolean;
  merchantOverrideAllowed: boolean;
  merchantOverrideAcknowledged: boolean;
};

export type AdImageSelection = {
  sourceMode: MerchantImageSourceMode;
  editMode: MerchantImageEditMode;
  sourcePhotoPath: string | null;
  selectedStoragePath: string | null;
  merchantSelected: boolean;
  selectedAt: string;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  qa: AdImageSelectionQa;
  lineage: ImageAssetLineage;
};

const SOURCE_MODES: ReadonlySet<MerchantImageSourceMode> = new Set([
  "merchant_original",
  "merchant_ai_edit",
  "ai_generated",
  "approved_stock",
  "deterministic_fallback",
]);

const EDIT_MODES: ReadonlySet<MerchantImageEditMode> = new Set([
  "none",
  "touchup",
  "clean_background",
  "studio_polish",
  "custom",
]);

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeMerchantImageSourceMode(
  value: unknown,
  fallback: MerchantImageSourceMode,
): MerchantImageSourceMode {
  const raw = clean(value).toLowerCase();
  return SOURCE_MODES.has(raw as MerchantImageSourceMode)
    ? (raw as MerchantImageSourceMode)
    : fallback;
}

export function normalizeMerchantImageEditMode(
  value: unknown,
  fallback: MerchantImageEditMode = "none",
): MerchantImageEditMode {
  const raw = clean(value).toLowerCase();
  return EDIT_MODES.has(raw as MerchantImageEditMode)
    ? (raw as MerchantImageEditMode)
    : fallback;
}

export function imageEditModeFromPhotoTreatment(
  treatment: MerchantPhotoTreatment | null | undefined,
): MerchantImageEditMode {
  if (treatment === "cleanbg") return "clean_background";
  if (treatment === "studiopolish") return "studio_polish";
  if (treatment === "touchup") return "touchup";
  return "none";
}

export function photoTreatmentFromImageEditMode(
  editMode: MerchantImageEditMode,
): MerchantPhotoTreatment | null {
  if (editMode === "clean_background") return "cleanbg";
  if (editMode === "studio_polish") return "studiopolish";
  if (editMode === "touchup") return "touchup";
  return null;
}

export function imageSourceModeFromPhotoSource(
  source: ProducedPhotoSource | null | undefined,
): MerchantImageSourceMode {
  if (source === "uploaded_original") return "merchant_original";
  if (source === "uploaded_enhanced") return "merchant_ai_edit";
  if (source === "stock") return "approved_stock";
  if (source === "copy_only" || source === "fallback_template") return "deterministic_fallback";
  return "ai_generated";
}

export function buildAdImageSelection(params: {
  photoSource: ProducedPhotoSource;
  editMode?: MerchantImageEditMode | null;
  sourcePhotoPath?: string | null;
  selectedStoragePath?: string | null;
  merchantSelected?: boolean;
  selectedAt?: string | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  qa: AdImageSelectionQa;
}): AdImageSelection {
  const sourceMode = imageSourceModeFromPhotoSource(params.photoSource);
  const editMode = sourceMode === "merchant_ai_edit" && params.editMode
    ? params.editMode
    : "none";
  const sourcePhotoPath = clean(params.sourcePhotoPath) || null;
  const selectedStoragePath = clean(params.selectedStoragePath) || null;
  return {
    sourceMode,
    editMode,
    sourcePhotoPath,
    selectedStoragePath,
    merchantSelected: params.merchantSelected !== false,
    selectedAt: params.selectedAt || new Date().toISOString(),
    provider: clean(params.provider) || null,
    model: clean(params.model) || null,
    promptVersion: clean(params.promptVersion) || null,
    qa: params.qa,
    lineage: buildImageAssetLineage({
      sourceMode,
      editMode,
      sourceStoragePath: sourcePhotoPath,
      outputStoragePath: selectedStoragePath,
      provider: params.provider,
      model: params.model,
      promptVersion: params.promptVersion,
    }),
  };
}

export function canPublishAdImageSelection(selection: AdImageSelection): boolean {
  if (selection.qa.decision === "block") return false;
  if (selection.qa.decision === "unavailable") {
    return selection.qa.merchantOverrideAllowed && selection.qa.merchantOverrideAcknowledged;
  }
  if (selection.qa.decision === "warn") {
    return !selection.qa.merchantOverrideAllowed || selection.qa.merchantOverrideAcknowledged;
  }
  return true;
}
