/**
 * Native wallet pass ("Twofer Card") — pure content logic shared by the Google
 * Wallet object builder, the future Apple pkpass renderer, and the redeem-path
 * scan parsing. Plan: docs/plans/native-wallet-pass-plan.md.
 *
 * Kept free of Deno/Supabase imports so the vitest suite can exercise it
 * directly (same pattern as owner-claim-push.ts). Deal facts come straight from
 * DB rows and are never altered here.
 */

export type WalletPassLocale = "en" | "es" | "ko";

/**
 * Pass barcode scheme. Encodes the claim short code — never the QR token — so
 * the server can rebuild the pass from the database alone (tokens are stored
 * hash-only). Redeeming by short code is an existing, rate-limited credential
 * path (staff manual entry), so this adds no new secret surface.
 */
export const WALLET_PASS_SCAN_PREFIX = "twofer://redeem/sc/";

/** How long the "Redeemed 🎉" state stays on the card before it returns to "No active deal". */
export const WALLET_PASS_REDEEMED_FRESH_HOURS = 24;

const SHORT_CODE_RE = /^[A-Z0-9]{4,12}$/;

export function normalizeWalletShortCode(value: string | null | undefined): string | null {
  const norm = (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return SHORT_CODE_RE.test(norm) ? norm : null;
}

/** `ABC123` → `twofer://redeem/sc/ABC123`; null when the code is not a plausible short code. */
export function buildShortCodeScanValue(shortCode: string | null | undefined): string | null {
  const norm = normalizeWalletShortCode(shortCode);
  return norm ? `${WALLET_PASS_SCAN_PREFIX}${norm}` : null;
}

/**
 * Recognizes a scanned wallet-pass barcode (`twofer://redeem/sc/<CODE>`) and
 * returns the normalized short code, or null for anything else — including
 * classic token URIs (`twofer://redeem/<uuid>`), which must keep flowing
 * through the token lookup untouched.
 */
export function parseShortCodeScanValue(scanned: string | null | undefined): string | null {
  const raw = (scanned ?? "").trim();
  if (raw.length <= WALLET_PASS_SCAN_PREFIX.length) return null;
  if (!raw.toLowerCase().startsWith(WALLET_PASS_SCAN_PREFIX)) return null;
  return normalizeWalletShortCode(raw.slice(WALLET_PASS_SCAN_PREFIX.length));
}

export function resolveWalletPassLocale(value: unknown): WalletPassLocale {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return v === "es" || v === "ko" ? v : "en";
}

/** Same 3+3 grouping the app shows staff (`ABC 123`). */
export function formatWalletShortCode(shortCode: string): string {
  return shortCode.length > 3 ? `${shortCode.slice(0, 3)} ${shortCode.slice(3)}` : shortCode;
}

// ---------------------------------------------------------------------------
// State derivation from deal_claims rows (newest first)
// ---------------------------------------------------------------------------

export type WalletPassClaimRow = {
  claim_status: string | null;
  redeemed_at: string | null;
  expires_at: string;
  grace_period_minutes: number | null;
  short_code: string | null;
  created_at: string;
  deal_title: string | null;
  deal_title_en: string | null;
  deal_title_es: string | null;
  deal_title_ko: string | null;
  deal_timezone: string | null;
  business_name: string | null;
  business_address: string | null;
  business_latitude: number | null;
  business_longitude: number | null;
  is_demo: boolean;
};

export type WalletPassState =
  | {
      kind: "active_deal";
      dealTitle: string | null;
      businessName: string | null;
      businessAddress: string | null;
      shortCode: string;
      redeemByIso: string;
      timezone: string | null;
      latitude: number | null;
      longitude: number | null;
    }
  | { kind: "redeemed"; dealTitle: string | null; businessName: string | null; redeemedAtIso: string }
  | { kind: "no_deal" };

const DEFAULT_GRACE_MINUTES = 10;

function redeemDeadlineMs(expiresAtIso: string, graceMinutes: number | null): number {
  const grace = typeof graceMinutes === "number" && graceMinutes > 0 ? graceMinutes : DEFAULT_GRACE_MINUTES;
  const expires = Date.parse(expiresAtIso);
  return Number.isFinite(expires) ? expires + grace * 60_000 : Number.NaN;
}

export function pickLocalizedDealTitle(row: WalletPassClaimRow, locale: WalletPassLocale): string | null {
  const localized =
    locale === "es" ? row.deal_title_es : locale === "ko" ? row.deal_title_ko : row.deal_title_en;
  const title = (localized ?? "").trim() || (row.deal_title ?? "").trim();
  return title.length > 0 ? title : null;
}

/**
 * Newest-first claim rows → the single truth the card shows. Demo offers never
 * reach the card. Legacy claims without a short code cannot render a scannable
 * barcode, so they are skipped rather than shown broken.
 */
export function deriveWalletPassState(
  rows: WalletPassClaimRow[],
  nowMs: number,
  locale: WalletPassLocale,
): WalletPassState {
  for (const row of rows) {
    if (row.is_demo) continue;
    const status = row.claim_status ?? "active";
    const isLive = (status === "active" || status === "redeeming") && !row.redeemed_at;
    if (!isLive) continue;
    const deadline = redeemDeadlineMs(row.expires_at, row.grace_period_minutes);
    if (!Number.isFinite(deadline) || nowMs >= deadline) continue;
    const shortCode = normalizeWalletShortCode(row.short_code);
    if (!shortCode) continue;
    return {
      kind: "active_deal",
      dealTitle: pickLocalizedDealTitle(row, locale),
      businessName: (row.business_name ?? "").trim() || null,
      businessAddress: (row.business_address ?? "").trim() || null,
      shortCode,
      redeemByIso: new Date(deadline).toISOString(),
      timezone: (row.deal_timezone ?? "").trim() || null,
      latitude: typeof row.business_latitude === "number" ? row.business_latitude : null,
      longitude: typeof row.business_longitude === "number" ? row.business_longitude : null,
    };
  }

  for (const row of rows) {
    if (row.is_demo) continue;
    const redeemedAt = row.redeemed_at;
    if (!redeemedAt && row.claim_status !== "redeemed") continue;
    const redeemedMs = redeemedAt ? Date.parse(redeemedAt) : Number.NaN;
    if (!Number.isFinite(redeemedMs)) continue;
    if (nowMs - redeemedMs > WALLET_PASS_REDEEMED_FRESH_HOURS * 3_600_000) continue;
    return {
      kind: "redeemed",
      dealTitle: pickLocalizedDealTitle(row, locale),
      businessName: (row.business_name ?? "").trim() || null,
      redeemedAtIso: new Date(redeemedMs).toISOString(),
    };
  }

  return { kind: "no_deal" };
}

// ---------------------------------------------------------------------------
// Rendered content (platform-neutral): strings per locale
// ---------------------------------------------------------------------------

type WalletPassStrings = {
  cardTitle: string;
  dealLabel: string;
  atLabel: string;
  redeemByLabel: string;
  codeLabel: string;
  dealFallback: string;
  redeemedHeader: string;
  redeemedSub: string;
  noDealHeader: string;
  noDealSub: string;
  openAppLink: string;
  supportLink: string;
};

const STRINGS: Record<WalletPassLocale, WalletPassStrings> = {
  en: {
    cardTitle: "Twofer",
    dealLabel: "Deal",
    atLabel: "At",
    redeemByLabel: "Redeem by",
    codeLabel: "Code",
    dealFallback: "Your deal",
    redeemedHeader: "Redeemed 🎉",
    redeemedSub: "See you next time.",
    noDealHeader: "No active deal",
    noDealSub: "Open Twofer to grab today's deal.",
    openAppLink: "Open Twofer",
    supportLink: "Support",
  },
  es: {
    cardTitle: "Twofer",
    dealLabel: "Oferta",
    atLabel: "En",
    redeemByLabel: "Canjear antes de",
    codeLabel: "Código",
    dealFallback: "Tu oferta",
    redeemedHeader: "¡Canjeado! 🎉",
    redeemedSub: "Hasta la próxima.",
    noDealHeader: "Sin oferta activa",
    noDealSub: "Abre Twofer y aprovecha la oferta de hoy.",
    openAppLink: "Abrir Twofer",
    supportLink: "Soporte",
  },
  ko: {
    cardTitle: "Twofer",
    dealLabel: "딜",
    atLabel: "매장",
    redeemByLabel: "사용 기한",
    codeLabel: "코드",
    dealFallback: "내 딜",
    redeemedHeader: "사용 완료 🎉",
    redeemedSub: "다음에 또 만나요.",
    noDealHeader: "진행 중인 딜 없음",
    noDealSub: "Twofer 앱에서 오늘의 딜을 받아보세요.",
    openAppLink: "Twofer 열기",
    supportLink: "고객 지원",
  },
};

const LOCALE_TAGS: Record<WalletPassLocale, string> = { en: "en-US", es: "es-MX", ko: "ko-KR" };
const DEFAULT_PASS_TZ = "America/Chicago";

/** "Jul 11, 2:00 PM" in the deal's timezone and the pass locale. Falls back to the ISO string on bad tz. */
export function formatWalletPassDateTime(
  iso: string,
  timezone: string | null,
  locale: WalletPassLocale,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
      timeZone: timezone || DEFAULT_PASS_TZ,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Brand: dark card, orange labels, penguin + Twofer logo (assets referenced by URL/pkpass bundle, never offer text in pixels). */
export const WALLET_PASS_BACKGROUND_HEX = "#11181C";
export const WALLET_PASS_LABEL_HEX = "#FF9F1C";
export const WALLET_PASS_FOREGROUND_HEX = "#FFFFFF";

export const WALLET_PASS_APP_URL = "https://twoferapp.com";
export const WALLET_PASS_SUPPORT_EMAIL = "support@twoferapp.com";

export type WalletPassContent = {
  state: WalletPassState["kind"];
  locale: WalletPassLocale;
  cardTitle: string;
  /** Big line on the card: deal title / "Redeemed 🎉" / "No active deal". */
  header: string;
  /** Small label above the header ("Deal") — empty for non-active states. */
  headerLabel: string;
  /** "At — Maya's Café" style rows; order matters for rendering. */
  rows: { id: "business" | "redeem_by" | "code" | "message"; label: string; value: string }[];
  barcode: { value: string; alternateText: string } | null;
  /** Redeem-by (+grace) — pass expirationDate / validTimeInterval end. */
  validUntilIso: string | null;
  /** Lock-screen geo relevance (Apple-only; Google dropped location triggers). */
  latitude: number | null;
  longitude: number | null;
  links: { uri: string; label: string }[];
};

export function buildWalletPassContent(state: WalletPassState, locale: WalletPassLocale): WalletPassContent {
  const s = STRINGS[locale];
  const links = [
    { uri: WALLET_PASS_APP_URL, label: s.openAppLink },
    { uri: `mailto:${WALLET_PASS_SUPPORT_EMAIL}`, label: s.supportLink },
  ];
  const base = {
    locale,
    cardTitle: s.cardTitle,
    links,
  };

  if (state.kind === "active_deal") {
    const rows: WalletPassContent["rows"] = [];
    const businessLine = state.businessAddress
      ? `${state.businessName ?? ""}${state.businessName ? " — " : ""}${state.businessAddress}`
      : state.businessName;
    if (businessLine) rows.push({ id: "business", label: s.atLabel, value: businessLine });
    rows.push({
      id: "redeem_by",
      label: s.redeemByLabel,
      value: formatWalletPassDateTime(state.redeemByIso, state.timezone, locale),
    });
    rows.push({ id: "code", label: s.codeLabel, value: formatWalletShortCode(state.shortCode) });
    return {
      ...base,
      state: state.kind,
      header: state.dealTitle ?? s.dealFallback,
      headerLabel: s.dealLabel,
      rows,
      barcode: {
        value: buildShortCodeScanValue(state.shortCode)!,
        alternateText: formatWalletShortCode(state.shortCode),
      },
      validUntilIso: state.redeemByIso,
      latitude: state.latitude,
      longitude: state.longitude,
    };
  }

  if (state.kind === "redeemed") {
    const rows: WalletPassContent["rows"] = [];
    const detail = [state.dealTitle, state.businessName].filter(Boolean).join(" — ");
    rows.push({ id: "message", label: detail || s.cardTitle, value: s.redeemedSub });
    return {
      ...base,
      state: state.kind,
      header: s.redeemedHeader,
      headerLabel: "",
      rows,
      barcode: null,
      validUntilIso: null,
      latitude: null,
      longitude: null,
    };
  }

  return {
    ...base,
    state: state.kind,
    header: s.noDealHeader,
    headerLabel: "",
    rows: [{ id: "message", label: s.cardTitle, value: s.noDealSub }],
    barcode: null,
    validUntilIso: null,
    latitude: null,
    longitude: null,
  };
}

// ---------------------------------------------------------------------------
// Google Wallet Generic object (pure JSON builder)
// ---------------------------------------------------------------------------

export const GOOGLE_WALLET_CLASS_SUFFIX = "twofer-card";

export function buildGoogleWalletObjectId(issuerId: string, userId: string): string {
  // Object id charset is [a-zA-Z0-9._-]; a UUID already qualifies.
  return `${issuerId}.${GOOGLE_WALLET_CLASS_SUFFIX}-${userId.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;
}

export function buildGoogleWalletClassId(issuerId: string): string {
  return `${issuerId}.${GOOGLE_WALLET_CLASS_SUFFIX}`;
}

function localized(locale: WalletPassLocale, value: string) {
  return { defaultValue: { language: LOCALE_TAGS[locale], value } };
}

export function buildGoogleWalletGenericObject(
  content: WalletPassContent,
  opts: { issuerId: string; objectId: string; logoUrl?: string | null },
): Record<string, unknown> {
  const object: Record<string, unknown> = {
    id: opts.objectId,
    classId: buildGoogleWalletClassId(opts.issuerId),
    state: "ACTIVE",
    hexBackgroundColor: WALLET_PASS_BACKGROUND_HEX,
    cardTitle: localized(content.locale, content.cardTitle),
    header: localized(content.locale, content.header),
    textModulesData: content.rows.map((row) => ({
      id: row.id,
      header: row.label,
      body: row.value,
    })),
    linksModuleData: {
      uris: content.links.map((link, idx) => ({ uri: link.uri, description: link.label, id: `link_${idx}` })),
    },
  };
  if (content.headerLabel) {
    object.subheader = localized(content.locale, content.headerLabel);
  }
  if (opts.logoUrl) {
    object.logo = {
      sourceUri: { uri: opts.logoUrl },
      contentDescription: localized(content.locale, content.cardTitle),
    };
  }
  if (content.barcode) {
    object.barcode = {
      type: "QR_CODE",
      value: content.barcode.value,
      alternateText: content.barcode.alternateText,
    };
  }
  if (content.validUntilIso) {
    object.validTimeInterval = { end: { date: content.validUntilIso } };
  }
  return object;
}

/** Claims for the "Save to Google Wallet" JWT; the object is pre-inserted so the JWT only references ids (short URL). */
export function buildGoogleSaveJwtClaims(opts: {
  serviceAccountEmail: string;
  issuerId: string;
  objectId: string;
  iatSeconds: number;
}): Record<string, unknown> {
  return {
    iss: opts.serviceAccountEmail,
    aud: "google",
    typ: "savetowallet",
    iat: opts.iatSeconds,
    payload: {
      genericObjects: [
        { id: opts.objectId, classId: buildGoogleWalletClassId(opts.issuerId) },
      ],
    },
  };
}
