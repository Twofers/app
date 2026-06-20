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
  forbidden_elements: string[];
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
      forbidden_elements: {
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
      "forbidden_elements",
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
    "Inspect this generated cafe deal image.",
    "Check only whether the required offer items are visibly present and prominent enough to understand the deal.",
    `Required items: ${items.join(", ")}.`,
    "Also check for forbidden elements: any readable text, letters, numbers, discount copy, business/app names, menu boards, signs, prices, coupons, QR codes, logos, brand marks, watermark-like marks, mascots, cartoon characters, animals, app mascots, or unrelated prop characters.",
    "Mark an item present only if a normal shopper could recognize it in the image.",
    "Mark an item prominent only if it is a main subject, not tiny background detail.",
    "Set has_readable_text true if any word, letter, number, or offer copy is visible, even if misspelled or stylized.",
    "Set has_forbidden_logo_or_brand true if any logo, app name, business name, brand mark, or watermark-like mark is visible.",
    "Set has_qr_code true if any QR/barcode-like mark is visible.",
    "Set has_unrelated_mascot_or_animal true if any mascot, cartoon character, animal, app mascot, or unrelated character prop is visible unless it is the actual product being sold.",
    "Put every forbidden element in forbidden_elements.",
    "If required items are missing or any forbidden element is present, all_required_items_present must be false.",
    "Return JSON only.",
  ].join(" ");
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
  const forbidden_elements = [
    ...(rawObject.has_readable_text === true ? ["readable text"] : []),
    ...(rawObject.has_forbidden_logo_or_brand === true ? ["logo or brand text"] : []),
    ...(rawObject.has_qr_code === true ? ["QR code"] : []),
    ...(rawObject.has_unrelated_mascot_or_animal === true ? ["unrelated mascot or animal"] : []),
    ...rawForbidden.map(cleanItem).filter(Boolean),
  ].filter((value, index, list) => list.indexOf(value) === index);
  const combined_missing_items = [...missing_items, ...forbidden_elements];
  return {
    all_required_items_present: combined_missing_items.length === 0,
    items,
    missing_items: combined_missing_items,
    has_readable_text: rawObject.has_readable_text === true,
    has_forbidden_logo_or_brand: rawObject.has_forbidden_logo_or_brand === true,
    has_qr_code: rawObject.has_qr_code === true,
    has_unrelated_mascot_or_animal: rawObject.has_unrelated_mascot_or_animal === true,
    forbidden_elements,
    notes: cleanItem(rawObject.notes),
  };
}
