export const DEAL_PHOTO_UPLOAD_MAX_SIDE = 1440;
export const DEAL_PHOTO_UPLOAD_JPEG_QUALITY = 0.82;

export type DealPhotoUploadDimensions = {
  width: number | null | undefined;
  height: number | null | undefined;
};

export type DealPhotoUploadResize = {
  width?: number;
  height?: number;
};

export type DealPhotoUploadCrop = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

function cleanDimension(value: number | null | undefined): number | null {
  if (!Number.isFinite(value) || value == null || value <= 0) return null;
  return value;
}

export function resolveDealPhotoUploadCrop(
  dimensions: DealPhotoUploadDimensions,
): DealPhotoUploadCrop | null {
  const width = cleanDimension(dimensions.width);
  const height = cleanDimension(dimensions.height);
  if (!width || !height || width === height) return null;

  const side = Math.min(width, height);
  return {
    originX: Math.round((width - side) / 2),
    originY: Math.round((height - side) / 2),
    width: Math.round(side),
    height: Math.round(side),
  };
}

export function resolveDealPhotoUploadResize(
  dimensions: DealPhotoUploadDimensions,
  maxSide = DEAL_PHOTO_UPLOAD_MAX_SIDE,
): DealPhotoUploadResize | null {
  const width = cleanDimension(dimensions.width);
  const height = cleanDimension(dimensions.height);
  if (!width || !height || !Number.isFinite(maxSide) || maxSide <= 0) return null;

  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return null;

  return width >= height ? { width: Math.round(maxSide) } : { height: Math.round(maxSide) };
}
