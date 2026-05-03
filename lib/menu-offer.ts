/**
 * Structured offer from menu-driven wizard - canonical facts for AI ad generation and refine.
 */

export type MenuOfferPairingType =
  | "free_with_purchase"
  | "bogo_pair"
  | "second_half_off"
  | "percent_off"
  | "fixed_price_special";

export type MenuItemRef = {
  id?: string;
  name: string;
  size_label?: string | null;
};

export type StructuredOffer = {
  main_item: MenuItemRef;
  paired_item?: MenuItemRef | null;
  pairing_type: MenuOfferPairingType;
  /** Single-line summary for prompts and Quick Deal hint */
  human_summary: string;
  /** For percent_off - must be >= 40 for strong-deal alignment */
  discount_percent?: number | null;
  /** For fixed_price_special - dollars */
  fixed_price_amount?: number | null;
};

export type ExtractedMenuItem = {
  name: string;
  category?: string;
  price_text?: string;
  size_options?: string[];
  readable?: boolean;
};

function displayItemName(item: MenuItemRef): string {
  const name = item.name.trim();
  const size = item.size_label?.trim();
  return size ? `${size} ${name}` : name;
}

export function buildOfferHintText(offer: StructuredOffer): string {
  return offer.human_summary.trim() || displayItemName(offer.main_item);
}

export function buildStructuredOffer(params: {
  main: MenuItemRef;
  paired: MenuItemRef | null;
  pairing_type: MenuOfferPairingType;
  discount_percent?: number | null;
  fixed_price_amount?: number | null;
}): StructuredOffer {
  const main = {
    id: params.main.id,
    name: params.main.name.trim(),
    size_label: params.main.size_label?.trim() || null,
  };
  const paired = params.paired
    ? {
        id: params.paired.id,
        name: params.paired.name.trim(),
        size_label: params.paired.size_label?.trim() || null,
      }
    : null;
  const mainName = displayItemName(main);
  const pairedName = paired ? displayItemName(paired) : null;
  const pct =
    typeof params.discount_percent === "number" && Number.isFinite(params.discount_percent)
      ? Math.round(params.discount_percent)
      : null;
  const fixedAmt =
    typeof params.fixed_price_amount === "number" && Number.isFinite(params.fixed_price_amount)
      ? params.fixed_price_amount
      : null;

  let human_summary: string;
  switch (params.pairing_type) {
    case "percent_off": {
      const p = pct != null && pct >= 40 ? pct : 40;
      human_summary = `${p}% off ${mainName}.`;
      break;
    }
    case "fixed_price_special": {
      const amt = fixedAmt != null ? fixedAmt.toFixed(2) : "?";
      human_summary = `Special price: ${mainName} for $${amt} - 40% or more off vs. everyday price.`;
      break;
    }
    case "bogo_pair":
      human_summary = paired
        ? `BOGO / 2-for-1: ${mainName} and ${pairedName}.`
        : `BOGO / 2-for-1: ${mainName}.`;
      break;
    case "second_half_off":
      human_summary = paired
        ? `Second item half off - ${mainName} + ${pairedName}.`
        : `50% off the second item - ${mainName}.`;
      break;
    case "free_with_purchase":
    default:
      human_summary = paired
        ? `Buy ${mainName}, get ${pairedName} free.`
        : `Buy ${mainName}, get a second item free.`;
  }

  return {
    main_item: main,
    paired_item: paired,
    pairing_type: params.pairing_type,
    human_summary,
    discount_percent: params.pairing_type === "percent_off" ? pct : null,
    fixed_price_amount: params.pairing_type === "fixed_price_special" ? fixedAmt : null,
  };
}
