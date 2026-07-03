import { buildOfferDefinitionV1 } from "../../../lib/offer-definition.ts";
import { renderLocalizedOfferFromDefinition } from "../../../lib/localized-offer-renderer.ts";
import {
  normalizeSupportedLocale,
  supportedLocaleOrDefault,
  supportedLocaleToAppLanguage,
  type SupportedLocale,
} from "../../../lib/supported-locales.ts";

export const PUBLIC_DEAL_BASE_SELECT =
  "id,title,business_id,location_id,start_time,end_time,is_active,max_claims,businesses(name,location,address)";

export const PUBLIC_DEAL_LOCALIZED_SELECT = [
  "id",
  "title",
  "title_en",
  "title_es",
  "title_ko",
  "source_locale",
  "business_id",
  "location_id",
  "start_time",
  "end_time",
  "is_active",
  "max_claims",
  "deal_type",
  "applies_to",
  "discount_percent",
  "customer_value_percent",
  "required_purchase_quantity",
  "free_item_quantity",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
  "free_item_discount_percent",
  "item_description",
  "item_retail_value_cents",
  "timezone",
  "businesses(name,location,address)",
].join(",");

const STRUCTURED_OR_LOCALIZED_COLUMNS = [
  "title_en",
  "title_es",
  "title_ko",
  "source_locale",
  "deal_type",
  "applies_to",
  "discount_percent",
  "customer_value_percent",
  "required_purchase_quantity",
  "free_item_quantity",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
  "free_item_discount_percent",
  "item_description",
  "item_retail_value_cents",
  "timezone",
];

export type ViewerLocaleCopy = {
  appName: string;
  genericDealTitle: string;
  genericBusinessName: string;
  liveLimitedBody: (businessName: string) => string;
  liveDetailsBody: (businessName: string) => string;
  digestTitle: string;
  digestBody: (count: number) => string;
  landingUnavailableSubtitle: string;
  landingAvailableSubtitle: string;
  landingUnavailableHint: string;
  landingAvailableHintHtml: string;
  openInApp: string;
  visitWebsite: string;
  getApp: string;
  poweredBy: string;
};

export const VIEWER_LOCALE_COPY: Record<SupportedLocale, ViewerLocaleCopy> = {
  "en-US": {
    appName: "Twofer",
    genericDealTitle: "Limited-time local offer",
    genericBusinessName: "a local business",
    liveLimitedBody: (businessName) => `Live now at ${businessName}. Claims are limited.`,
    liveDetailsBody: (businessName) => `Live now at ${businessName}. Open Twofer for details.`,
    digestTitle: "New deals near you",
    digestBody: (count) =>
      count === 1 ? "1 new deal near you this week." : `${count} new deals near you this week.`,
    landingUnavailableSubtitle:
      "This Twofer deal is unavailable or has ended. Open Twofer to find live local deals.",
    landingAvailableSubtitle:
      "Claim this local offer in seconds. Open Twofer and show it at the counter.",
    landingUnavailableHint: "Visit twoferapp.com or open the app to browse live local deals.",
    landingAvailableHintHtml:
      "Don't have the app yet? Tap above to visit twoferapp.com.<br/>After installing, scan this code again to claim your deal.",
    openInApp: "Open in Twofer",
    visitWebsite: "Visit twoferapp.com",
    getApp: "Get Twofer at twoferapp.com",
    poweredBy: "Powered by Twofer - local deals, zero waste",
  },
  "es-US": {
    appName: "Twofer",
    genericDealTitle: "Oferta local por tiempo limitado",
    genericBusinessName: "un negocio local",
    liveLimitedBody: (businessName) => `Disponible ahora en ${businessName}. Hay cantidades limitadas.`,
    liveDetailsBody: (businessName) => `Disponible ahora en ${businessName}. Abre Twofer para ver los detalles.`,
    digestTitle: "Nuevas ofertas cerca de ti",
    digestBody: (count) =>
      count === 1
        ? "1 oferta nueva cerca de ti esta semana."
        : `${count} ofertas nuevas cerca de ti esta semana.`,
    landingUnavailableSubtitle:
      "Esta oferta de Twofer no está disponible o ya terminó. Abre Twofer para encontrar ofertas locales activas.",
    landingAvailableSubtitle:
      "Reclama esta oferta local en segundos. Abre Twofer y muéstrala en el mostrador.",
    landingUnavailableHint: "Visita twoferapp.com o abre la app para ver ofertas locales activas.",
    landingAvailableHintHtml:
      "¿Aún no tienes la app? Toca arriba para visitar twoferapp.com.<br/>Después de instalarla, escanea este código otra vez para reclamar tu oferta.",
    openInApp: "Abrir en Twofer",
    visitWebsite: "Visitar twoferapp.com",
    getApp: "Obtén Twofer en twoferapp.com",
    poweredBy: "Con tecnología de Twofer - ofertas locales, cero desperdicio",
  },
  "ko-KR": {
    appName: "Twofer",
    genericDealTitle: "기간 한정 지역 혜택",
    genericBusinessName: "지역 매장",
    liveLimitedBody: (businessName) => `${businessName}에서 지금 이용할 수 있어요. 수량이 제한되어 있어요.`,
    liveDetailsBody: (businessName) => `${businessName}에서 지금 이용할 수 있어요. Twofer에서 자세히 확인하세요.`,
    digestTitle: "근처 새 혜택",
    digestBody: (count) =>
      count === 1 ? "이번 주 근처에 새 혜택 1개가 있어요." : `이번 주 근처에 새 혜택 ${count}개가 있어요.`,
    landingUnavailableSubtitle:
      "이 Twofer 혜택은 사용할 수 없거나 종료되었어요. Twofer에서 진행 중인 지역 혜택을 찾아보세요.",
    landingAvailableSubtitle:
      "Twofer를 열고 매장에서 보여 주면 지역 혜택을 바로 사용할 수 있어요.",
    landingUnavailableHint: "twoferapp.com을 방문하거나 앱을 열어 진행 중인 지역 혜택을 둘러보세요.",
    landingAvailableHintHtml:
      "아직 앱이 없나요? 위 버튼을 눌러 twoferapp.com을 방문하세요.<br/>설치 후 이 코드를 다시 스캔해 혜택을 받으세요.",
    openInApp: "Twofer에서 열기",
    visitWebsite: "twoferapp.com 방문",
    getApp: "twoferapp.com에서 Twofer 받기",
    poweredBy: "Twofer 제공 - 지역 혜택, 음식 낭비 줄이기",
  },
};

export type PublicDealRow = Record<string, unknown> & {
  id?: string | null;
  title?: string | null;
  business_id?: string | null;
  location_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  max_claims?: number | string | null;
  source_locale?: string | null;
  businesses?: unknown;
};

export type PublicDealDisplay = {
  title: string;
  businessName: string;
  locale: SupportedLocale;
  source: "structured_offer" | "legacy_localized_title" | "generic_fallback";
};

export function isMissingPublicDealLocalizationColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
      (error.code === "PGRST204" || error.code === "42703" || message.includes("schema cache") || message.includes("column")) &&
      STRUCTURED_OR_LOCALIZED_COLUMNS.some((column) => message.includes(column)),
  );
}

export function resolveViewerLocaleFromRequest(req: Request, url = new URL(req.url)): SupportedLocale {
  const explicit = normalizeSupportedLocale(url.searchParams.get("lang"));
  if (explicit) return explicit;

  const acceptLanguage = req.headers.get("accept-language") ?? "";
  for (const part of acceptLanguage.split(",")) {
    const tag = part.split(";")[0]?.trim();
    const locale = normalizeSupportedLocale(tag);
    if (locale) return locale;
  }
  return "en-US";
}

export function supportedLocaleFromAppLocale(value: unknown): SupportedLocale {
  if (typeof value !== "string") return "en-US";
  if (value === "en" || value === "es" || value === "ko") {
    return supportedLocaleOrDefault(value);
  }
  return supportedLocaleOrDefault(value);
}

export function localeHtmlLang(locale: SupportedLocale): string {
  return supportedLocaleToAppLanguage(locale);
}

export function localeCopy(locale: SupportedLocale): ViewerLocaleCopy {
  return VIEWER_LOCALE_COPY[locale] ?? VIEWER_LOCALE_COPY["en-US"];
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function positiveInt(value: unknown): number | null {
  const n = numeric(value);
  return n != null && n > 0 ? Math.floor(n) : null;
}

export function nestedBusinessName(data: { businesses?: unknown } | null | undefined, locale: SupportedLocale): string {
  const business = Array.isArray(data?.businesses) ? data.businesses[0] : data?.businesses;
  if (business && typeof business === "object" && "name" in business) {
    const name = (business as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return localeCopy(locale).genericBusinessName;
}

function nestedLocationName(data: { businesses?: unknown } | null | undefined): string {
  const business = Array.isArray(data?.businesses) ? data.businesses[0] : data?.businesses;
  if (business && typeof business === "object") {
    const location = cleanText((business as { location?: unknown }).location);
    const address = cleanText((business as { address?: unknown }).address);
    const name = cleanText((business as { name?: unknown }).name);
    return location || address || name;
  }
  return "";
}

function dealEligibilityFromRow(row: Record<string, unknown>) {
  const dealType = cleanText(row.deal_type);
  if (!dealType) return null;
  return {
    dealType,
    appliesTo: cleanText(row.applies_to) || "SINGLE_ITEM",
    discountPercent: row.discount_percent as number | string | null | undefined,
    requiredPurchaseQuantity: row.required_purchase_quantity as number | string | null | undefined,
    freeItemQuantity: row.free_item_quantity as number | string | null | undefined,
    requiredItemDescription: row.required_item_description as string | null | undefined,
    requiredItemRetailValueCents: row.required_item_retail_value_cents as number | string | null | undefined,
    freeItemDescription: row.free_item_description as string | null | undefined,
    freeItemRetailValueCents: row.free_item_retail_value_cents as number | string | null | undefined,
    freeItemDiscountPercent: row.free_item_discount_percent as number | string | null | undefined,
    itemDescription: row.item_description as string | null | undefined,
    itemRetailValueCents: row.item_retail_value_cents as number | string | null | undefined,
  };
}

function structuredOfferTitle(row: PublicDealRow, locale: SupportedLocale, businessName: string): string | null {
  const dealEligibility = dealEligibilityFromRow(row);
  if (!dealEligibility) return null;

  const definition = buildOfferDefinitionV1({
    businessId: cleanText(row.business_id) || "deal-business",
    businessName,
    locationId: cleanText(row.location_id) || cleanText(row.business_id) || "deal-location",
    locationName: nestedLocationName(row) || businessName,
    dealEligibility,
    eligibilityResult: {
      eligible: true,
      eligibilityStatus: "VALID",
      customerValuePercent: numeric(row.customer_value_percent) ?? undefined,
    },
    quantityLimit: positiveInt(row.max_claims),
    schedule: {
      mode: row.start_time || row.end_time ? "one_time" : "summary_only",
      startsAt: cleanText(row.start_time) || null,
      endsAt: cleanText(row.end_time) || null,
      timeZone: cleanText(row.timezone) || null,
    },
  });
  if (!definition) return null;

  const rendered = renderLocalizedOfferFromDefinition(definition, { locale });
  const sourceLocale = normalizeSupportedLocale(cleanText(row.source_locale));
  const hasUnreviewedPreservedTerm = rendered.localizedTermSnapshotIds.some((id) =>
    id.includes("preserved-merchant-term-v1"),
  );
  if (hasUnreviewedPreservedTerm && sourceLocale !== locale) return null;
  return cleanText(rendered.compactOfferLine);
}

function legacyLocalizedTitle(row: PublicDealRow, locale: SupportedLocale): string | null {
  const field =
    locale === "es-US" ? row.title_es : locale === "ko-KR" ? row.title_ko : row.title_en;
  const localized = cleanText(field);
  if (localized) return localized;

  const sourceLocale = normalizeSupportedLocale(cleanText(row.source_locale));
  const raw = cleanText(row.title);
  if (sourceLocale && sourceLocale === locale && raw) return raw;
  return null;
}

export function buildPublicDealDisplay(row: PublicDealRow | null | undefined, locale: SupportedLocale): PublicDealDisplay {
  const businessName = nestedBusinessName(row, locale);
  if (row) {
    const structured = structuredOfferTitle(row, locale, businessName);
    if (structured) {
      return { title: structured, businessName, locale, source: "structured_offer" };
    }

    const legacyTitle = legacyLocalizedTitle(row, locale);
    if (legacyTitle) {
      return { title: legacyTitle, businessName, locale, source: "legacy_localized_title" };
    }
  }

  return {
    title: localeCopy(locale).genericDealTitle,
    businessName,
    locale,
    source: "generic_fallback",
  };
}

export function buildDealReleasePushCopy(
  row: PublicDealRow,
  locale: SupportedLocale,
): { title: string; body: string } {
  const display = buildPublicDealDisplay(row, locale);
  const copy = localeCopy(locale);
  const hasLimit = positiveInt(row.max_claims) != null;
  return {
    title: display.title,
    body: hasLimit
      ? copy.liveLimitedBody(display.businessName)
      : copy.liveDetailsBody(display.businessName),
  };
}

export function buildDigestPushCopy(locale: SupportedLocale, count: number): { title: string; body: string } {
  const copy = localeCopy(locale);
  return {
    title: copy.digestTitle,
    body: copy.digestBody(count),
  };
}

export async function fetchProfileLocaleByUserId(
  admin: any,
  userIds: string[],
): Promise<Map<string, SupportedLocale>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, SupportedLocale>();
  if (uniqueIds.length === 0) return out;

  try {
    const { data, error } = await admin
      .from("profiles")
      .select("id,app_locale")
      .in("id", uniqueIds);
    if (error) return out;
    for (const row of data ?? []) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;
      out.set(id, supportedLocaleFromAppLocale(row.app_locale));
    }
  } catch {
    return out;
  }
  return out;
}
