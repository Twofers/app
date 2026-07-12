import { SUPPORTED_LOCALES, type SupportedLocale } from "../supported-locales.ts";
import type { OfferDefinitionV1 } from "../offer-definition.ts";
import { assertPosterCopyPolicy } from "./posterPolicy.ts";
import { buildPosterOfferLinesFromOfferDefinition } from "./posterCopy.ts";
import type { PosterCopyV1, PosterSpecV1, PosterTemplateId } from "./posterTypes.ts";

const POSTER_TEMPLATE_IDS = new Set<PosterTemplateId>(["fresh", "bold", "premium"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function posterCopy(value: unknown): PosterCopyV1 | null {
  const copy = record(value);
  if (!copy) return null;
  const businessName = cleanText(copy.business_name);
  const headline = cleanText(copy.headline);
  const line1 = cleanText(copy.offer_line_1);
  const line2 = cleanText(copy.offer_line_2);
  if (!businessName || !headline || !line1 || !line2) return null;
  return {
    business_name: businessName,
    headline,
    offer_line_1: line1,
    offer_line_2: line2,
    ...(cleanText(copy.subline) ? { subline: cleanText(copy.subline) } : {}),
  };
}

export function posterCopyForLocale(
  spec: PosterSpecV1,
  locale: SupportedLocale | string | null | undefined,
): PosterCopyV1 | null {
  const supported = SUPPORTED_LOCALES.includes(locale as SupportedLocale) ? (locale as SupportedLocale) : "en-US";
  return spec.copy_by_language[supported] ?? spec.copy_by_language["en-US"] ?? Object.values(spec.copy_by_language)[0] ?? null;
}

export function parsePosterSpecV1(value: unknown): PosterSpecV1 | null {
  const spec = record(value);
  if (!spec) return null;
  const templateId = cleanText(spec.template_id) as PosterTemplateId;
  const copyByLanguageRecord = record(spec.copy_by_language);
  if (
    spec.version !== 1 ||
    spec.enabled !== true ||
    spec.aspect_ratio !== "4:5" ||
    !POSTER_TEMPLATE_IDS.has(templateId) ||
    !copyByLanguageRecord
  ) {
    return null;
  }
  const copyByLanguage = {} as PosterSpecV1["copy_by_language"];
  for (const locale of SUPPORTED_LOCALES) {
    const copy = posterCopy(copyByLanguageRecord[locale]);
    if (copy) copyByLanguage[locale] = copy;
  }
  if (!copyByLanguage["en-US"] && Object.keys(copyByLanguage).length === 0) return null;

  const layout = record(spec.layout_policy);
  const content = record(spec.content_policy);
  const maxLines = record(layout?.max_lines);
  if (layout?.text_align !== "center") return null;
  if (
    content?.no_app_brand_token !== true ||
    content?.no_cta !== true ||
    content?.no_scarcity !== true ||
    content?.no_mutable_live_facts !== true ||
    content?.image_text_free !== true
  ) {
    return null;
  }

  const parsed: PosterSpecV1 = {
    version: 1,
    enabled: true,
    template_id: templateId,
    aspect_ratio: "4:5",
    source_asset_path: cleanText(spec.source_asset_path) || null,
    rendered_asset_path: cleanText(spec.rendered_asset_path) || null,
    copy_by_language: copyByLanguage,
    layout_policy: {
      text_align: "center",
      safe_area_percent: Number(layout?.safe_area_percent) || 8,
      max_lines: {
        business_name: Number(maxLines?.business_name) || 1,
        headline: Number(maxLines?.headline) || 2,
        offer_line_1: Number(maxLines?.offer_line_1) || 1,
        offer_line_2: Number(maxLines?.offer_line_2) || 1,
        subline: Number(maxLines?.subline) || 1,
      },
    },
    content_policy: {
      no_app_brand_token: true,
      no_cta: true,
      no_scarcity: true,
      no_mutable_live_facts: true,
      image_text_free: true,
    },
  };
  return validatePosterSpecV1(parsed).valid ? parsed : null;
}

export function posterSpecFromAdSpec(value: unknown): PosterSpecV1 | null {
  const spec = record(value);
  if (!spec) return null;
  const creativeFormat = cleanText(spec.creative_format);
  if (creativeFormat && creativeFormat !== "poster_v1") return null;
  return parsePosterSpecV1(spec.poster);
}

export function validatePosterSpecV1(
  value: unknown,
  options: { offerDefinition?: OfferDefinitionV1 | null; businessId?: string | null } = {},
): { valid: boolean; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const spec = record(value);
  if (!spec) return { valid: false, reasonCodes: ["POSTER_NOT_OBJECT"] };
  const parsed = parsePosterSpecV1Loose(spec);
  if (!parsed) return { valid: false, reasonCodes: ["INVALID_POSTER_SPEC"] };

  for (const locale of Object.keys(parsed.copy_by_language) as SupportedLocale[]) {
    const policy = assertPosterCopyPolicy(parsed.copy_by_language[locale]);
    if (!policy.passed) {
      reasonCodes.push(...policy.reasonCodes.map((code) => `POSTER_${code}`));
    }
  }

  if (options.offerDefinition) {
    for (const locale of Object.keys(parsed.copy_by_language) as SupportedLocale[]) {
      const expected = buildPosterOfferLinesFromOfferDefinition(options.offerDefinition, locale);
      const copy = parsed.copy_by_language[locale];
      if (copy.offer_line_1 !== expected.offer_line_1) reasonCodes.push("POSTER_OFFER_LINE_1_MISMATCH");
      if (copy.offer_line_2 !== expected.offer_line_2) reasonCodes.push("POSTER_OFFER_LINE_2_MISMATCH");
    }
  }
  const sourcePath = cleanText(parsed.source_asset_path);
  const businessId = cleanText(options.businessId);
  if (sourcePath && businessId && !sourcePath.startsWith(`${businessId}/`)) {
    reasonCodes.push("POSTER_SOURCE_ASSET_OUTSIDE_BUSINESS");
  }
  if (parsed.rendered_asset_path != null) {
    reasonCodes.push("POSTER_RENDERED_ASSET_NOT_SUPPORTED");
  }
  return { valid: reasonCodes.length === 0, reasonCodes: [...new Set(reasonCodes)] };
}

function parsePosterSpecV1Loose(spec: Record<string, unknown>): PosterSpecV1 | null {
  const templateId = cleanText(spec.template_id) as PosterTemplateId;
  const copyByLanguageRecord = record(spec.copy_by_language);
  const layout = record(spec.layout_policy);
  const content = record(spec.content_policy);
  if (
    spec.version !== 1 ||
    spec.enabled !== true ||
    spec.aspect_ratio !== "4:5" ||
    !POSTER_TEMPLATE_IDS.has(templateId) ||
    !copyByLanguageRecord ||
    layout?.text_align !== "center" ||
    content?.no_app_brand_token !== true ||
    content?.no_cta !== true ||
    content?.no_scarcity !== true ||
    content?.no_mutable_live_facts !== true ||
    content?.image_text_free !== true
  ) {
    return null;
  }
  const copyByLanguage = {} as PosterSpecV1["copy_by_language"];
  for (const locale of SUPPORTED_LOCALES) {
    const copy = posterCopy(copyByLanguageRecord[locale]);
    if (copy) copyByLanguage[locale] = copy;
  }
  if (!copyByLanguage["en-US"] && Object.keys(copyByLanguage).length === 0) return null;
  return spec as unknown as PosterSpecV1;
}
