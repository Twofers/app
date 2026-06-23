export type QuickDealImageQaItem = {
  item: string;
  present: boolean;
  prominent: boolean;
};

export type QuickDealImageQaResult = {
  all_required_items_present: boolean;
  items: QuickDealImageQaItem[];
  missing_items: string[];
  has_readable_text: boolean;
  has_forbidden_logo_or_brand: boolean;
  has_qr_code: boolean;
  has_unrelated_mascot_or_animal: boolean;
  has_crop_or_overlay_risk: boolean;
  forbidden_elements: string[];
  crop_or_overlay_issues: string[];
  notes: string;
};

export type AdImageQaSourceType =
  | "merchant_original"
  | "merchant_ai_edit"
  | "ai_generated"
  | "approved_stock"
  | "deterministic_fallback";

export type AdImageQaDecision = "pass" | "warn" | "block" | "unavailable" | "not_checked";

export type SourceAwareImageQaResult = {
  checked: boolean;
  available: boolean;
  sourceType: AdImageQaSourceType;
  decision: AdImageQaDecision;
  hardFailReasons: string[];
  warningCodes: string[];
  missingItems: string[];
  forbiddenElements: string[];
  merchantOverrideAllowed: boolean;
  merchantOverrideAcknowledged: boolean;
  notes: string;
};

export const QUICK_DEAL_IMAGE_QA_SCHEMA = {
  name: "quick_deal_image_qa",
  strict: true,
  schema: {
    type: "object",
    properties: {
      all_required_items_present: { type: "boolean" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string" },
            present: { type: "boolean" },
            prominent: { type: "boolean" },
          },
          required: ["item", "present", "prominent"],
          additionalProperties: false,
        },
      },
      missing_items: {
        type: "array",
        items: { type: "string" },
      },
      has_readable_text: { type: "boolean" },
      has_forbidden_logo_or_brand: { type: "boolean" },
      has_qr_code: { type: "boolean" },
      has_unrelated_mascot_or_animal: { type: "boolean" },
      has_crop_or_overlay_risk: { type: "boolean" },
      forbidden_elements: {
        type: "array",
        items: { type: "string" },
      },
      crop_or_overlay_issues: {
        type: "array",
        items: { type: "string" },
      },
      notes: { type: "string" },
    },
    required: [
      "all_required_items_present",
      "items",
      "missing_items",
      "has_readable_text",
      "has_forbidden_logo_or_brand",
      "has_qr_code",
      "has_unrelated_mascot_or_animal",
      "has_crop_or_overlay_risk",
      "forbidden_elements",
      "crop_or_overlay_issues",
      "notes",
    ],
    additionalProperties: false,
  },
} as const;

function cleanItem(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function buildQuickDealImageQaPrompt(requiredVisualItems: readonly string[]): string {
  const items = requiredVisualItems.map(cleanItem).filter(Boolean);
  return [
    "Inspect this deal image.",
    "Check only whether the required offer items are visibly present and prominent enough to understand the deal.",
    `Required items: ${items.join(", ")}.`,
    "Also check for forbidden elements: any readable text, letters, numbers, discount copy, business/app names, menu boards, signs, prices, coupons, QR codes, logos, brand marks, watermark-like marks, mascots, cartoon characters, animals, app mascots, or unrelated prop characters.",
    "Also check mobile crop and overlay safety: the final card is a square 1:1 image, native offer text may overlay near the top or bottom, and required items should remain recognizable in the center-safe area.",
    "Mark an item present only if a normal shopper could recognize it in the image.",
    "Mark an item prominent only if it is a main subject, not tiny background detail.",
    "Set has_readable_text true if any word, letter, number, or offer copy is visible, even if misspelled or stylized.",
    "Set has_forbidden_logo_or_brand true if any logo, app name, business name, brand mark, or watermark-like mark is visible.",
    "Set has_qr_code true if any QR/barcode-like mark is visible.",
    "Set has_unrelated_mascot_or_animal true if any mascot, cartoon character, animal, app mascot, or unrelated character prop is visible unless it is the actual product being sold.",
    "Set has_crop_or_overlay_risk true if a required item is cut off, too close to an edge, likely covered by top/bottom text overlays, hard to recognize after square cover crop, or placed on a background too busy for native text.",
    "Put every forbidden element in forbidden_elements.",
    "Put concise crop or overlay problems in crop_or_overlay_issues.",
    "If required items are missing, any forbidden element is present, or crop/overlay risk is present, all_required_items_present must be false.",
    "Return JSON only.",
  ].join(" ");
}

export function buildAdImageQaPrompt(params: {
  sourceType: AdImageQaSourceType;
  requiredVisualItems: readonly string[];
}): string {
  const sourceGuidance =
    params.sourceType === "merchant_original"
      ? "This is the merchant's original photo. Treat imperfect lighting, background clutter, crop/overlay limits, and non-prominent required items as warnings unless a forbidden hard blocker appears."
      : params.sourceType === "merchant_ai_edit"
      ? "This is an AI-edited derivative of the merchant's photo. It must preserve the required offer items, keep them usable in a square mobile card with native text overlays, and must not introduce text, prices, coupons, QR codes, fake logos, mascots, animals, or unrelated props."
      : params.sourceType === "approved_stock"
      ? "This is approved stock media. It must still match the offer items, work in a square mobile card with native text overlays, and must not contain forbidden ad graphics."
      : params.sourceType === "deterministic_fallback"
      ? "This is a deterministic native-rendered fallback. No vision inspection is required."
      : "This is a fully AI-generated image. It must show the required offer items, work in a square mobile card with native text overlays, and must not contain forbidden ad graphics.";
  return [sourceGuidance, buildQuickDealImageQaPrompt(params.requiredVisualItems)].join(" ");
}

export function buildQuickDealImageRegenerationPrompt(params: {
  basePrompt: string;
  requiredVisualItems: readonly string[];
  missingItems: readonly string[];
}): string {
  const required = params.requiredVisualItems.map(cleanItem).filter(Boolean);
  const missing = params.missingItems.map(cleanItem).filter(Boolean);
  return [
    "Regenerate the ad image.",
    missing.length > 0 ? `The previous image missed: ${missing.join(", ")}.` : "The previous image did not clearly show the full offer.",
    `The new image must clearly show all required offer items as main subjects: ${required.join(", ")}.`,
    "Make every required item clearly visible and equally important.",
    "Remove all readable text, letters, numbers, app names, business names, logos, prices, coupons, menu boards, QR codes, watermark-like marks, mascots, cartoon characters, animals, app mascots, and unrelated character props.",
    params.basePrompt,
  ]
    .filter(Boolean)
    .join(" ");
}

export function normalizeQuickDealImageQaResult(
  raw: unknown,
  requiredVisualItems: readonly string[],
): QuickDealImageQaResult {
  const required = requiredVisualItems.map(cleanItem).filter(Boolean);
  const rawObject = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const rawItems = Array.isArray(rawObject.items) ? rawObject.items : [];
  const items = required.map((item) => {
    const match = rawItems.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      return cleanItem((entry as { item?: unknown }).item).toLowerCase() === item.toLowerCase();
    }) as { present?: unknown; prominent?: unknown } | undefined;
    return {
      item,
      present: match?.present === true,
      prominent: match?.prominent === true,
    };
  });
  const missing_items = items
    .filter((item) => !item.present || !item.prominent)
    .map((item) => item.item);
  const rawForbidden = Array.isArray(rawObject.forbidden_elements) ? rawObject.forbidden_elements : [];
  const rawCropIssues = Array.isArray(rawObject.crop_or_overlay_issues) ? rawObject.crop_or_overlay_issues : [];
  const crop_or_overlay_issues = rawCropIssues.map(cleanItem).filter(Boolean);
  const has_crop_or_overlay_risk =
    rawObject.has_crop_or_overlay_risk === true || crop_or_overlay_issues.length > 0;
  const forbidden_elements = [
    ...(rawObject.has_readable_text === true ? ["readable text"] : []),
    ...(rawObject.has_forbidden_logo_or_brand === true ? ["logo or brand text"] : []),
    ...(rawObject.has_qr_code === true ? ["QR code"] : []),
    ...(rawObject.has_unrelated_mascot_or_animal === true ? ["unrelated mascot or animal"] : []),
    ...rawForbidden.map(cleanItem).filter(Boolean),
  ].filter((value, index, list) => list.indexOf(value) === index);
  const crop_or_overlay_missing = has_crop_or_overlay_risk
    ? [...(crop_or_overlay_issues.length > 0 ? crop_or_overlay_issues : ["crop or overlay risk"])]
    : [];
  const combined_missing_items = [...missing_items, ...forbidden_elements, ...crop_or_overlay_missing];
  return {
    all_required_items_present: combined_missing_items.length === 0,
    items,
    missing_items: combined_missing_items,
    has_readable_text: rawObject.has_readable_text === true,
    has_forbidden_logo_or_brand: rawObject.has_forbidden_logo_or_brand === true,
    has_qr_code: rawObject.has_qr_code === true,
    has_unrelated_mascot_or_animal: rawObject.has_unrelated_mascot_or_animal === true,
    has_crop_or_overlay_risk,
    forbidden_elements,
    crop_or_overlay_issues,
    notes: cleanItem(rawObject.notes),
  };
}

function reasonCode(prefix: string, value: string): string {
  return `${prefix}:${value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

function unavailableDecision(
  sourceType: AdImageQaSourceType,
  merchantOverrideAcknowledged = false,
): SourceAwareImageQaResult {
  const merchantOriginal = sourceType === "merchant_original";
  return {
    checked: false,
    available: false,
    sourceType,
    decision: merchantOriginal ? "unavailable" : "block",
    hardFailReasons: merchantOriginal ? [] : ["VISION_QA_UNAVAILABLE"],
    warningCodes: merchantOriginal ? ["VISION_QA_UNAVAILABLE"] : [],
    missingItems: [],
    forbiddenElements: [],
    merchantOverrideAllowed: merchantOriginal,
    merchantOverrideAcknowledged,
    notes: "Image QA unavailable.",
  };
}

export function normalizeSourceAwareImageQaResult(params: {
  raw: QuickDealImageQaResult | null | undefined;
  requiredVisualItems: readonly string[];
  sourceType: AdImageQaSourceType;
  merchantOverrideAcknowledged?: boolean;
}): SourceAwareImageQaResult {
  if (params.sourceType === "deterministic_fallback") {
    return {
      checked: false,
      available: true,
      sourceType: params.sourceType,
      decision: "not_checked",
      hardFailReasons: [],
      warningCodes: [],
      missingItems: [],
      forbiddenElements: [],
      merchantOverrideAllowed: false,
      merchantOverrideAcknowledged: false,
      notes: "Native fallback uses rendered text and no generated image asset.",
    };
  }
  if (!params.raw) {
    return unavailableDecision(params.sourceType, params.merchantOverrideAcknowledged === true);
  }

  const qa = params.raw;
  const missingItems = qa.items
    .filter((item) => !item.present || !item.prominent)
    .map((item) => item.item);
  const forbiddenElements = qa.forbidden_elements;
  const cropOrOverlayIssues = qa.has_crop_or_overlay_risk
    ? qa.crop_or_overlay_issues.length > 0 ? qa.crop_or_overlay_issues : ["crop or overlay risk"]
    : [];
  const forbiddenReasons = [
    ...(qa.has_readable_text ? ["READABLE_TEXT"] : []),
    ...(qa.has_forbidden_logo_or_brand ? ["LOGO_OR_BRAND_MARK"] : []),
    ...(qa.has_qr_code ? ["QR_OR_BARCODE"] : []),
    ...(qa.has_unrelated_mascot_or_animal ? ["UNRELATED_MASCOT_OR_ANIMAL"] : []),
    ...forbiddenElements.map((item) => reasonCode("FORBIDDEN_ELEMENT", item)),
  ];
  const cropOrOverlayReasons = cropOrOverlayIssues.map((item) => reasonCode("CROP_OR_OVERLAY_RISK", item));
  const generatedLike =
    params.sourceType === "ai_generated" ||
    params.sourceType === "merchant_ai_edit" ||
    params.sourceType === "approved_stock";
  const hardFailReasons = generatedLike
    ? [
      ...missingItems.map((item) => reasonCode("MISSING_REQUIRED_ITEM", item)),
      ...forbiddenReasons,
      ...cropOrOverlayReasons,
    ]
    : forbiddenReasons;
  const warningCodes =
    params.sourceType === "merchant_original"
      ? [
        ...missingItems.map((item) => reasonCode("ITEM_NOT_PROMINENT", item)),
        ...cropOrOverlayIssues.map((item) => reasonCode("CROP_OR_OVERLAY_WARNING", item)),
      ]
      : [];
  const decision: AdImageQaDecision =
    hardFailReasons.length > 0
      ? "block"
      : warningCodes.length > 0
      ? "warn"
      : "pass";

  return {
    checked: true,
    available: true,
    sourceType: params.sourceType,
    decision,
    hardFailReasons: [...new Set(hardFailReasons)],
    warningCodes: [...new Set(warningCodes)],
    missingItems: [...new Set(missingItems)],
    forbiddenElements: [...new Set(forbiddenElements)],
    merchantOverrideAllowed: decision === "warn" && params.sourceType === "merchant_original",
    merchantOverrideAcknowledged: params.merchantOverrideAcknowledged === true,
    notes: qa.notes,
  };
}

export function unavailableSourceAwareImageQaResult(params: {
  sourceType: AdImageQaSourceType;
  merchantOverrideAcknowledged?: boolean;
}): SourceAwareImageQaResult {
  return unavailableDecision(params.sourceType, params.merchantOverrideAcknowledged === true);
}

export function shouldFailClosedForImageQa(result: SourceAwareImageQaResult): boolean {
  return result.decision === "block";
}
