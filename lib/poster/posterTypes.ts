import type { SupportedLocale } from "../supported-locales.ts";

export type AdCreativeFormat = "standard_card" | "poster_v1";

export type PosterTemplateId = "fresh" | "bold" | "premium";

export type PosterStyleChoice = "auto" | PosterTemplateId;

export type PosterCopyV1 = {
  business_name: string;
  headline: string;
  offer_line_1: string;
  offer_line_2: string;
  subline?: string;
};

export type PosterPolicyResult = {
  passed: boolean;
  reasonCodes: string[];
  removedTerms: string[];
  warnings: string[];
};

export type PosterSpecV1 = {
  version: 1;
  enabled: boolean;
  template_id: PosterTemplateId;
  aspect_ratio: "4:5";
  source_asset_path: string | null;
  rendered_asset_path: string | null;
  copy_by_language: Record<SupportedLocale, PosterCopyV1>;
  layout_policy: {
    text_align: "center";
    safe_area_percent: number;
    max_lines: {
      business_name: number;
      headline: number;
      offer_line_1: number;
      offer_line_2: number;
      subline: number;
    };
  };
  content_policy: {
    no_app_brand_token: true;
    no_cta: true;
    no_scarcity: true;
    no_mutable_live_facts: true;
    image_text_free: true;
  };
};

export type PosterDraftV1 = Omit<PosterSpecV1, "copy_by_language"> & {
  copy: PosterCopyV1;
  copy_by_language: PosterSpecV1["copy_by_language"];
  policy: PosterPolicyResult;
  composition_plan?: string | null;
};

export type PosterSanitizeOptions = {
  fallback?: string;
  maxChars?: number;
  uppercase?: boolean;
};
