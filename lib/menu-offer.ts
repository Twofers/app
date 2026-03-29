/**
 * Structured offer from menu-driven wizard — canonical facts for AI ad generation and refine.
 */

export type MenuOfferPairingType = "free_with_purchase" | "bogo_pair" | "second_half_off";

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
}): StructuredOffer {
  const main = { id: params.main.id, name: params.main.name.trim() };
  const paired = params.paired
    ? { id: params.paired.id, name: params.paired.name.trim() }
    : null;

  let human_summary: string;
  switch (params.pairing_type) {
    case "bogo_pair":
      human_summary = paired
        ? `BOGO / 2-for-1: ${main.name} and ${paired.name}.`
        : `BOGO / 2-for-1: ${main.name}.`;
      break;
    case "second_half_off":
      human_summary = paired
        ? `Buy ${main.name}, get ${paired.name} half off.`
        : `Half off second item on ${main.name}.`;
      break;
    case "free_with_purchase":
    default:
      human_summary = paired
        ? `Buy ${main.name}, get ${paired.name} free.`
        : `Featured item: ${main.name}.`;
  }

  return {
    main_item: main,
    paired_item: paired,
    pairing_type: params.pairing_type,
    human_summary,
  };
}
