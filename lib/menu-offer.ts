/**
 * Structured offer from menu-driven wizard — canonical facts for AI ad generation and refine.
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
};

export type StructuredOffer = {
  main_item: MenuItemRef;
  paired_item?: MenuItemRef | null;
  pairing_type: MenuOfferPairingType;
  /** Single-line summary for prompts and Quick Deal hint */
  human_summary: string;
  /** For percent_off — must be >= 40 for strong-deal alignment */
  discount_percent?: number | null;
  /** For fixed_price_special — dollars */
  fixed_price_amount?: number | null;
};

export type ExtractedMenuItem = {
  name: string;
  category?: string;
  price_text?: string;
  readable?: boolean;
};

export function buildOfferHintText(offer: StructuredOffer): string {
  return offer.human_summary.trim() || offer.main_item.name.trim();
}

export function buildStructuredOffer(params: {
  main: MenuItemRef;
  paired: MenuItemRef | null;
  pairing_type: MenuOfferPairingType;
  discount_percent?: number | null;
  fixed_price_amount?: number | null;
}): StructuredOffer {
  const main = { id: params.main.id, name: params.main.name.trim() };
  const paired = params.paired
    ? { id: params.paired.id, name: params.paired.name.trim() }
    : null;
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
      human_summary = `${p}% off ${main.name}.`;
      break;
    }
    case "fixed_price_special": {
      const amt = fixedAmt != null ? fixedAmt.toFixed(2) : "?";
      human_summary = `Special price: ${main.name} for $${amt} — 40% or more off vs. everyday price.`;
      break;
    }
    case "bogo_pair":
      human_summary = paired
        ? `BOGO / 2-for-1: ${main.name} and ${paired.name}.`
        : `BOGO / 2-for-1: ${main.name}.`;
      break;
    case "second_half_off":
      human_summary = paired
        ? `Second item half off — ${main.name} + ${paired.name}.`
        : `50% off the second item — ${main.name}.`;
      break;
    case "free_with_purchase":
    default:
      human_summary = paired
        ? `Buy ${main.name}, get ${paired.name} free.`
        : `Buy ${main.name}, get a second item free.`;
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
