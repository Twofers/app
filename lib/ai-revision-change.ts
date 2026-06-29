import type { GeneratedAd } from "./ad-variants";
import type { AiRevisionTarget } from "./ai-revision-target";

export type AiRevisionChangeSummary = {
  copyChanged: boolean;
  imageChanged: boolean;
  hasExpectedChange: boolean;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function visibleCopyFingerprint(ad: GeneratedAd): string {
  const posterCopy = ad.poster?.copy;
  return [
    ad.headline,
    ad.short_description,
    ad.subheadline,
    ad.cta,
    ad.push_notification,
    ad.social_caption,
    ad.terms_summary,
    posterCopy?.headline,
    posterCopy?.offer_line_1,
    posterCopy?.offer_line_2,
    posterCopy?.subline,
  ].map(clean).join("|");
}

function visibleImageFingerprint(ad: GeneratedAd): string {
  const selection = ad.image_selection;
  return [
    ad.poster_storage_path,
    ad.photo_source,
    ad.photo_treatment,
    selection?.sourceMode,
    selection?.editMode,
    selection?.sourcePhotoPath,
    selection?.selectedStoragePath,
  ].map(clean).join("|");
}

export function summarizeAiRevisionChange(params: {
  previousAd: GeneratedAd;
  revisedAd: GeneratedAd;
  target: AiRevisionTarget;
}): AiRevisionChangeSummary {
  const copyChanged = visibleCopyFingerprint(params.previousAd) !== visibleCopyFingerprint(params.revisedAd);
  const imageChanged = visibleImageFingerprint(params.previousAd) !== visibleImageFingerprint(params.revisedAd);
  const hasExpectedChange = params.target === "copy"
    ? copyChanged
    : params.target === "image"
      ? imageChanged
      : copyChanged || imageChanged;

  return {
    copyChanged,
    imageChanged,
    hasExpectedChange,
  };
}
