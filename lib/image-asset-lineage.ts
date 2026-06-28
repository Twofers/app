import type { MerchantImageEditMode, MerchantImageSourceMode } from "./merchant-image-selection.ts";

export type ImageAssetLineage = {
  sourceMode: MerchantImageSourceMode;
  editMode: MerchantImageEditMode;
  sourceAssetId: string | null;
  outputAssetId: string | null;
  sourceStoragePath: string | null;
  outputStoragePath: string | null;
  derivative: boolean;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
};

function storageAssetId(storagePath: string | null | undefined): string | null {
  const clean = typeof storagePath === "string" ? storagePath.trim() : "";
  return clean ? `deal-photos:${clean}` : null;
}

export function buildImageAssetLineage(params: {
  sourceMode: MerchantImageSourceMode;
  editMode: MerchantImageEditMode;
  sourceStoragePath?: string | null;
  outputStoragePath?: string | null;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
}): ImageAssetLineage {
  const sourceStoragePath = params.sourceStoragePath?.trim() || null;
  const outputStoragePath = params.outputStoragePath?.trim() || null;
  return {
    sourceMode: params.sourceMode,
    editMode: params.editMode,
    sourceAssetId: storageAssetId(sourceStoragePath),
    outputAssetId: storageAssetId(outputStoragePath),
    sourceStoragePath,
    outputStoragePath,
    derivative: Boolean(sourceStoragePath && outputStoragePath && sourceStoragePath !== outputStoragePath),
    provider: params.provider?.trim() || null,
    model: params.model?.trim() || null,
    promptVersion: params.promptVersion?.trim() || null,
  };
}
