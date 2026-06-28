import { renderAuthoritativeOfferFromDefinition } from "./authoritative-offer-renderer.ts";
import {
  localizedTermSnapshotId,
  resolveLocalizedOfferTerm,
  type LocalizedOfferTerm,
} from "./localized-offer-terms.ts";
import { getOfferLocaleTemplate } from "./offer-locale-templates.ts";
import {
  buildOfferDefinitionV1FromContract,
  type OfferDefinitionV1,
  type OfferDefinitionV1Item,
} from "./offer-definition.ts";
import { resolveKoreanOfferTemplate } from "./korean-offer-template-resolver.ts";
import { SUPPORTED_LOCALES, supportedLocaleOrDefault, type SupportedLocale } from "./supported-locales.ts";
import type { DealOfferContract } from "./deal-offer-contract.ts";

export type LocalizedLockedOfferContent = {
  locale: SupportedLocale;
  primaryOfferLine: string;
  compactOfferLine: string;
  termsLine: string;
  accessibilityOfferDescription: string;
  templateId: string;
  templateVersion: string;
  localizedTermSnapshotIds: string[];
};

export type RenderLocalizedOfferOptions = {
  locale?: string | null;
  providedTerms?: readonly LocalizedOfferTerm[] | null;
  doNotTranslateTerms?: readonly string[] | null;
};

type OfferFacts = {
  offerType: OfferDefinitionV1["offerType"];
  paidItem: OfferDefinitionV1Item;
  rewardItemName: string;
  rewardQuantity: number;
  discountPercent: number | null;
  totalClaimLimit: number | null;
  locationName: string;
  scheduleSummary: string | null;
  perUserClaimLimit: number;
};

export const LOCALIZED_OFFER_RENDERER_VERSION = "twofer-localized-offer-renderer-v1";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function sentence(value: string): string {
  const clean = cleanText(value);
  if (!clean) return "";
  return /[.!?。]$/.test(clean) ? clean : `${clean}.`;
}

function number(locale: SupportedLocale, value: number): string {
  return new Intl.NumberFormat(locale).format(Math.max(0, Math.floor(value)));
}

const EN_NUMBER_WORDS: Record<number, string> = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
};

function enNumberWord(value: number): string {
  return EN_NUMBER_WORDS[value] ?? String(value);
}

function stripLeadingArticle(value: string): string {
  return cleanText(value).replace(/^(?:a|an|the)\s+/i, "");
}

function lowerFirst(value: string): string {
  const clean = cleanText(value);
  if (!clean) return "";
  if (/^[A-Z]{2,}\b/.test(clean)) return clean;
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(clean)) return clean;
  return `${clean.charAt(0).toLowerCase()}${clean.slice(1)}`;
}

function articleFor(nounPhrase: string): "a" | "an" {
  const clean = stripLeadingArticle(nounPhrase);
  if (/^(?:honest|hour|heir|herb)\b/i.test(clean)) return "an";
  if (/^(?:uni([^nmd]|$)|user|useful|utensil|u[bcfhjkqrst][a-z])/i.test(clean)) return "a";
  return /^[aeiou]/i.test(clean) ? "an" : "a";
}

function pluralizeWord(word: string): string {
  if (!word || /[^A-Za-z]$/.test(word)) return word;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/fe$/i.test(word)) return `${word.slice(0, -2)}ves`;
  if (/f$/i.test(word)) return `${word.slice(0, -1)}ves`;
  return `${word}s`;
}

function pluralizeItemPhrase(value: string): string {
  const clean = stripLeadingArticle(value);
  const match = clean.match(/([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
  if (!match) return clean;
  const [full, word, suffix] = match;
  if (/s$/i.test(word) && !/(?:ss|us)$/i.test(word)) return clean;
  return `${clean.slice(0, clean.length - full.length)}${pluralizeWord(word)}${suffix}`;
}

function enCountedItem(quantity: number, itemName: string): string {
  const item = stripLeadingArticle(itemName);
  if (quantity === 1) return `one ${lowerFirst(item)}`;
  return `${enNumberWord(quantity)} ${pluralizeItemPhrase(item)}`;
}

function enPurchasePhrase(quantity: number, itemName: string): string {
  const item = cleanText(itemName);
  if (quantity === 1) return `${articleFor(item)} ${lowerFirst(stripLeadingArticle(item))}`;
  return `${enNumberWord(quantity)} ${pluralizeItemPhrase(item)}`;
}

function enFreeRewardPhrase(quantity: number, itemName: string): string {
  const item = cleanText(itemName);
  if (quantity === 1) return `${articleFor(item)} free ${lowerFirst(stripLeadingArticle(item))}`;
  return `${enNumberWord(quantity)} free ${pluralizeItemPhrase(item)}`;
}

function sameItem(left: string, right: string): boolean {
  const normalize = (value: string) =>
    stripLeadingArticle(value)
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9가-힣\s-]/g, " ")
      .replace(/(?:ies)\b/g, "y")
      .replace(/s\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return normalize(left) === normalize(right);
}

function offerFacts(definition: OfferDefinitionV1): OfferFacts {
  const paidItem = definition.qualifyingItems[0] ?? {
    catalogItemId: null,
    displayName: "item",
    quantity: 1,
    verifiedAttributes: [],
  };
  if (definition.offerType === "percent_off_single_item") {
    return {
      offerType: definition.offerType,
      paidItem,
      rewardItemName: definition.reward.displayNames[0] ?? paidItem.displayName,
      rewardQuantity: 1,
      discountPercent: definition.reward.discountPercent,
      totalClaimLimit: definition.totalClaimLimit,
      locationName: definition.locationName,
      scheduleSummary: definition.schedule.summary,
      perUserClaimLimit: definition.perUserClaimLimit,
    };
  }
  return {
    offerType: definition.offerType,
    paidItem,
    rewardItemName: definition.reward.displayNames[0] ?? paidItem.displayName,
    rewardQuantity: definition.reward.quantity,
    discountPercent: null,
    totalClaimLimit: definition.totalClaimLimit,
    locationName: definition.locationName,
    scheduleSummary: definition.schedule.summary,
    perUserClaimLimit: definition.perUserClaimLimit,
  };
}

function termsForFacts(
  facts: OfferFacts,
  locale: SupportedLocale,
  options: RenderLocalizedOfferOptions,
): { paidTerm: LocalizedOfferTerm; rewardTerm: LocalizedOfferTerm } {
  const paidTerm = resolveLocalizedOfferTerm({
    entityId: facts.paidItem.catalogItemId,
    sourceDisplayName: facts.paidItem.displayName,
    locale,
    providedTerms: options.providedTerms,
    doNotTranslateTerms: options.doNotTranslateTerms,
  });
  const rewardTerm = resolveLocalizedOfferTerm({
    entityId: facts.offerType === "percent_off_single_item" ? facts.paidItem.catalogItemId : `reward:${facts.rewardItemName}`,
    sourceDisplayName: facts.rewardItemName,
    locale,
    providedTerms: options.providedTerms,
    doNotTranslateTerms: options.doNotTranslateTerms,
  });
  return { paidTerm, rewardTerm };
}

function renderEnglishLine(facts: OfferFacts, paidTerm: LocalizedOfferTerm, rewardTerm: LocalizedOfferTerm): string {
  if (facts.offerType === "percent_off_single_item") {
    return `Get ${facts.discountPercent ?? 0}% off one ${lowerFirst(stripLeadingArticle(paidTerm.displayName))}`;
  }
  if (facts.offerType === "buy_one_get_one" || sameItem(paidTerm.displayName, rewardTerm.displayName)) {
    const rewardPhrase = facts.rewardQuantity === 1 ? "one free" : `${enNumberWord(facts.rewardQuantity)} free`;
    return `Buy ${enCountedItem(facts.paidItem.quantity, paidTerm.displayName)} and get ${rewardPhrase}`;
  }
  return `Buy ${enPurchasePhrase(facts.paidItem.quantity, paidTerm.displayName)} and get ${enFreeRewardPhrase(facts.rewardQuantity, rewardTerm.displayName)}`;
}

function renderSpanishLine(facts: OfferFacts, paidTerm: LocalizedOfferTerm, rewardTerm: LocalizedOfferTerm): string {
  if (facts.offerType === "percent_off_single_item") {
    return `Recibe ${facts.discountPercent ?? 0}% de descuento en ${number("es-US", facts.paidItem.quantity)} ${paidTerm.displayName}`;
  }
  return `Al comprar ${number("es-US", facts.paidItem.quantity)} ${paidTerm.displayName}, recibes ${number("es-US", facts.rewardQuantity)} ${rewardTerm.displayName} gratis`;
}

function renderKoreanLine(facts: OfferFacts, paidTerm: LocalizedOfferTerm, rewardTerm: LocalizedOfferTerm): string {
  const resolution = resolveKoreanOfferTemplate({ paidTerm, rewardTerm });
  if (facts.offerType === "percent_off_single_item") {
    return [
      `할인 항목: ${paidTerm.displayName} × ${number("ko-KR", facts.paidItem.quantity)}`,
      `혜택: ${number("ko-KR", facts.discountPercent ?? 0)}% 할인`,
    ].join("\n");
  }
  if (!resolution.usesCounters) {
    return [
      `구매 항목: ${paidTerm.displayName} × ${number("ko-KR", facts.paidItem.quantity)}`,
      `추가 혜택: ${rewardTerm.displayName} × ${number("ko-KR", facts.rewardQuantity)}`,
    ].join("\n");
  }
  return [
    `구매 항목: ${paidTerm.displayName} × ${number("ko-KR", facts.paidItem.quantity)}`,
    `추가 혜택: ${rewardTerm.displayName} × ${number("ko-KR", facts.rewardQuantity)}`,
  ].join("\n");
}

function localizedTermsLine(facts: OfferFacts, locale: SupportedLocale, englishTermsLine: string): string {
  if (locale === "en-US") return englishTermsLine;
  const quantityLine =
    facts.totalClaimLimit != null
      ? locale === "es-US"
        ? `Hay ${number("es-US", facts.totalClaimLimit)} reclamos disponibles.`
        : `사용 가능한 수량: ${number("ko-KR", facts.totalClaimLimit)}.`
      : locale === "es-US"
        ? "Cantidad limitada disponible."
        : "수량 한정.";
  const scheduleLine = facts.scheduleSummary
    ? locale === "es-US"
      ? `Horario de la oferta: ${facts.scheduleSummary}.`
      : `제공 시간: ${facts.scheduleSummary}.`
    : "";
  if (locale === "es-US") {
    return [
      `Canjea solo en ${facts.locationName}.`,
      facts.perUserClaimLimit === 1 ? "Límite de una reclamación por cliente." : `Límite de ${facts.perUserClaimLimit} reclamaciones por cliente.`,
      quantityLine,
      scheduleLine,
    ].filter(Boolean).join(" ");
  }
  return [
    `지정 매장: ${facts.locationName}.`,
    facts.perUserClaimLimit === 1 ? "고객당 1회 청구 가능." : `고객당 ${facts.perUserClaimLimit}회 청구 가능.`,
    quantityLine,
    scheduleLine,
  ].filter(Boolean).join(" ");
}

function compactLine(value: string): string {
  return cleanText(value.replace(/\n/g, " · "));
}

export function renderLocalizedOfferFromDefinition(
  definition: OfferDefinitionV1,
  options: RenderLocalizedOfferOptions = {},
): LocalizedLockedOfferContent {
  const locale = supportedLocaleOrDefault(options.locale);
  const facts = offerFacts(definition);
  const { paidTerm, rewardTerm } = termsForFacts(facts, locale, options);
  const template = getOfferLocaleTemplate(locale, definition.offerType);
  const english = renderAuthoritativeOfferFromDefinition(definition);
  const primaryOfferLine =
    locale === "en-US"
      ? renderEnglishLine(facts, paidTerm, rewardTerm)
      : locale === "es-US"
        ? renderSpanishLine(facts, paidTerm, rewardTerm)
        : renderKoreanLine(facts, paidTerm, rewardTerm);
  const termsLine = localizedTermsLine(facts, locale, english.termsLine);
  const compactOfferLine = compactLine(primaryOfferLine);
  const accessibilityOfferDescription = [sentence(compactOfferLine), termsLine].filter(Boolean).join(" ");

  return {
    locale,
    primaryOfferLine,
    compactOfferLine,
    termsLine,
    accessibilityOfferDescription,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    localizedTermSnapshotIds: [
      localizedTermSnapshotId(paidTerm),
      ...(sameItem(paidTerm.displayName, rewardTerm.displayName) ? [] : [localizedTermSnapshotId(rewardTerm)]),
    ],
  };
}

export function renderLocalizedOfferFromContract(
  contract: DealOfferContract,
  options: RenderLocalizedOfferOptions = {},
): LocalizedLockedOfferContent {
  return renderLocalizedOfferFromDefinition(buildOfferDefinitionV1FromContract(contract), options);
}

export function renderLocalizedOfferBundleFromDefinition(
  definition: OfferDefinitionV1,
  options: Omit<RenderLocalizedOfferOptions, "locale"> = {},
): Record<SupportedLocale, LocalizedLockedOfferContent> {
  return Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [locale, renderLocalizedOfferFromDefinition(definition, { ...options, locale })]),
  ) as Record<SupportedLocale, LocalizedLockedOfferContent>;
}
