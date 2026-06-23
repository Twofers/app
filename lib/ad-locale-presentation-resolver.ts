import {
  buildDefaultAdPresentationSpec,
  type AdLayoutTemplateId,
  type AdPresentationLocaleOverride,
  type AdPresentationSpec,
  type AdTextPanel,
} from "./ad-presentation-spec";
import { estimateAdTextFit, type AdTextFitResult } from "./ad-text-fit";
import type { AdLocalizationBundle, AdLocalizedCreative } from "./ad-localization-schema";
import type { ApprovedAdCopy, MerchantDisplayIdentity } from "./ad-render-content";
import type { SupportedLocale } from "./supported-locales";
import { SUPPORTED_LOCALES } from "./supported-locales";

export type LocalePresentationResolution = {
  presentation: AdPresentationSpec;
  localeOverrides: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>>;
  reasonCodesByLocale: Partial<Record<SupportedLocale, string[]>>;
  screenshotQaTriggerLocales: SupportedLocale[];
};

export type ResolveLocalePresentationOverridesInput = {
  basePresentation: AdPresentationSpec;
  localizationBundle: AdLocalizationBundle;
  merchantIdentity: MerchantDisplayIdentity;
  enabledLocales?: readonly SupportedLocale[] | null;
  ctaLabels?: Partial<Record<SupportedLocale, string>>;
  statusLabelsByLocale?: Partial<Record<SupportedLocale, readonly string[]>>;
};

const DEFAULT_CTA_LABELS: Record<SupportedLocale, string> = {
  "en-US": "Claim deal",
  "es-US": "Reclamar oferta",
  "ko-KR": "\uB51C \uBC1B\uAE30",
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function hasHangul(value: string): boolean {
  return /[\u3131-\u318E\uAC00-\uD7A3]/u.test(value);
}

function localizedCopy(localization: AdLocalizedCreative, ctaLabel: string): ApprovedAdCopy {
  return {
    headline: localization.headline,
    supportingCopy: localization.supportingCopy,
    ctaLabel,
    imageAltText: localization.imageAltText,
  };
}

function localizedLockedOffer(localization: AdLocalizedCreative) {
  const exactOfferLine = clean(localization.exactOfferLine);
  const termsLine = clean(localization.termsLine);
  return {
    primaryOfferLine: exactOfferLine,
    compactOfferLine: exactOfferLine,
    termsLine,
    accessibilityOfferDescription: [exactOfferLine, termsLine].filter(Boolean).join(". "),
  };
}

function panelForTemplate(templateId: AdLayoutTemplateId, fallback: AdTextPanel): AdTextPanel {
  if (templateId === "split_offer_panel") return "solid_bottom";
  if (fallback === "bottom_gradient") return "solid_bottom";
  return fallback;
}

function chooseTemplate(params: {
  baseTemplateId: AdLayoutTemplateId;
  baseFit: AdTextFitResult;
  locale: SupportedLocale;
  localization: AdLocalizedCreative;
}): { templateId: AdLayoutTemplateId; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const exactText = [
    params.localization.headline,
    params.localization.supportingCopy,
    params.localization.exactOfferLine,
    params.localization.termsLine,
  ].join(" ");
  const isKoreanText = params.locale === "ko-KR" || hasHangul(exactText);
  const isLongSpanishText =
    params.locale === "es-US" &&
    (
      clean(params.localization.headline).length > 58 ||
      clean(params.localization.exactOfferLine).length > 78 ||
      clean(params.localization.supportingCopy).length > 110
    );

  if (params.baseFit.repairCodes.includes("REMOVE_SUPPORTING_COPY")) {
    reasonCodes.push("REMOVE_SUPPORTING_COPY");
  }
  if (params.baseFit.repairCodes.includes("USE_COMPACT_OFFER_LINE")) {
    reasonCodes.push("USE_EXACT_LOCALE_OFFER_LINE");
  }
  if (isLongSpanishText) {
    reasonCodes.push("LONG_SPANISH_COPY_SAFE_SPLIT");
  }
  if (isKoreanText) {
    reasonCodes.push("HANGUL_FONT_METRICS_GUARD");
  }

  const needsSplit =
    !params.baseFit.fits ||
    params.baseFit.repairCodes.includes("SWITCH_TO_SAFE_TEMPLATE") ||
    params.baseFit.repairCodes.includes("USE_SPLIT_OFFER_PANEL") ||
    isLongSpanishText ||
    (isKoreanText && params.baseTemplateId !== "split_offer_panel");

  if (!needsSplit) {
    return {
      templateId: params.baseTemplateId,
      reasonCodes,
    };
  }

  return {
    templateId: "split_offer_panel",
    reasonCodes: unique([
      ...reasonCodes,
      "LOCALE_PRESENTATION_SAFE_SPLIT",
      ...params.baseFit.repairCodes,
    ]),
  };
}

function shouldPersistOverride(params: {
  basePresentation: AdPresentationSpec;
  templateId: AdLayoutTemplateId;
  showSupportingCopy: boolean;
  actionableReasonCodes: readonly string[];
}): boolean {
  return (
    params.templateId !== params.basePresentation.templateId ||
    params.showSupportingCopy !== params.basePresentation.showSupportingCopy ||
    params.actionableReasonCodes.length > 0
  );
}

export function resolveLocalePresentationOverrides(
  input: ResolveLocalePresentationOverridesInput,
): LocalePresentationResolution {
  const enabledLocales = input.enabledLocales?.length ? [...input.enabledLocales] : [...SUPPORTED_LOCALES];
  const localeOverrides: Partial<Record<SupportedLocale, AdPresentationLocaleOverride>> = {};
  const reasonCodesByLocale: Partial<Record<SupportedLocale, string[]>> = {};
  const screenshotQaTriggerLocales: SupportedLocale[] = [];

  for (const locale of enabledLocales) {
    const localization = input.localizationBundle.localizations[locale];
    if (!localization) continue;
    const ctaLabel = clean(input.ctaLabels?.[locale]) || DEFAULT_CTA_LABELS[locale];
    const statusLabels = (input.statusLabelsByLocale?.[locale] ?? []).map(clean).filter(Boolean);
    const copy = localizedCopy(localization, ctaLabel);
    const lockedOfferContent = localizedLockedOffer(localization);
    const baseFit = estimateAdTextFit({
      approvedCopy: copy,
      lockedOfferContent,
      merchantIdentity: input.merchantIdentity,
      templateId: input.basePresentation.templateId,
      ctaLabel,
      statusLabels,
    });
    const selected = chooseTemplate({
      baseTemplateId: input.basePresentation.templateId,
      baseFit,
      locale,
      localization,
    });
    const selectedFit = estimateAdTextFit({
      approvedCopy: copy,
      lockedOfferContent,
      merchantIdentity: input.merchantIdentity,
      templateId: selected.templateId,
      ctaLabel,
      statusLabels,
    });
    const actionableReasonCodes = unique([
      ...selected.reasonCodes,
      ...selectedFit.repairCodes,
      ...(selectedFit.offerFits ? [] : ["EXACT_OFFER_LINE_OVERFLOW"]),
      ...(selectedFit.fits ? [] : ["LOCALE_TEXT_FIT_REVIEW_REQUIRED"]),
    ]);
    const showSupportingCopy =
      selectedFit.showSupportingCopy && !actionableReasonCodes.includes("REMOVE_SUPPORTING_COPY");

    if (!selectedFit.fits || actionableReasonCodes.includes("EXACT_OFFER_LINE_OVERFLOW")) {
      screenshotQaTriggerLocales.push(locale);
    }
    reasonCodesByLocale[locale] = actionableReasonCodes;
    if (
      shouldPersistOverride({
        basePresentation: input.basePresentation,
        templateId: selected.templateId,
        showSupportingCopy,
        actionableReasonCodes,
      })
    ) {
      const resolutionReasonCodes = unique([`LOCALE_PRESENTATION_${locale}`, ...actionableReasonCodes]);
      localeOverrides[locale] = {
        templateId: selected.templateId,
        textPanel: panelForTemplate(selected.templateId, input.basePresentation.textPanel),
        showSupportingCopy,
        resolutionReasonCodes,
      };
    }
  }

  return {
    presentation: buildDefaultAdPresentationSpec({
      ...input.basePresentation,
      localeOverrides,
    }),
    localeOverrides,
    reasonCodesByLocale,
    screenshotQaTriggerLocales: unique(screenshotQaTriggerLocales) as SupportedLocale[],
  };
}
