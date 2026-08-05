import { describe, expect, it } from "vitest";
import {
  COMPOSE_CTA_MAX_CHARS,
  COMPOSE_HEADLINE_MAX_CHARS,
  COMPOSE_SUBHEADLINE_MAX_CHARS,
  formatRepairInstruction,
  validateComposeOutput,
} from "./validate-output.ts";

const OFFER_TYPES = [
  "bogo_same_item",
  "bogo_second_item_half_off",
  "free_add_on_with_purchase",
  "simple_bundle_offer",
] as const;

function baseVariant(overrides: Record<string, unknown> = {}) {
  return {
    variant_id: "A",
    headline_en: "Buy one latte, get one free",
    headline_es: "Compra un latte, llevate otro gratis",
    headline_ko: "라떼 하나 사면 하나 무료",
    subheadline_en: "Todays only at the counter.",
    subheadline_es: "Solo hoy en el mostrador.",
    subheadline_ko: "오늘만 카운터에서.",
    cta_en: "Claim now",
    cta_es: "Reclamar",
    cta_ko: "지금 받기",
    style_label: "clarity",
    rationale: "leads with the mechanic",
    visual_direction: "counter shot",
    ...overrides,
  };
}

function baseOffer(overrides: Record<string, unknown> = {}) {
  return {
    offer_type: "bogo_same_item",
    item_name: "Latte",
    display_offer: "Buy one latte, get one free",
    ...overrides,
  };
}

describe("validateComposeOutput", () => {
  it("passes a valid output untouched", () => {
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer(),
      variants: [baseVariant({ variant_id: "A" }), baseVariant({ variant_id: "B" })],
    });
    expect(result).toEqual({ ok: true });
  });

  it("flags a headline over the stated 42-char limit", () => {
    const longHeadline = "A".repeat(COMPOSE_HEADLINE_MAX_CHARS + 1);
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer(),
      variants: [baseVariant({ variant_id: "A", headline_en: longHeadline }), baseVariant({ variant_id: "B" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === "HEADLINE_OVER_LIMIT")).toBe(true);
    }
  });

  it("flags an over-limit subheadline and cta at their stated limits", () => {
    const longSubheadline = "B".repeat(COMPOSE_SUBHEADLINE_MAX_CHARS + 1);
    const longCta = "C".repeat(COMPOSE_CTA_MAX_CHARS + 1);
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer(),
      variants: [
        baseVariant({ variant_id: "A", subheadline_en: longSubheadline, cta_en: longCta }),
        baseVariant({ variant_id: "B" }),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === "SUBHEADLINE_OVER_LIMIT")).toBe(true);
      expect(result.violations.some((v) => v.code === "CTA_OVER_LIMIT")).toBe(true);
    }
  });

  it("flags BOGO and Same-Item text", () => {
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ display_offer: "BOGO deal on lattes" }),
      variants: [
        baseVariant({ variant_id: "A", headline_en: "Same-Item swap available" }),
        baseVariant({ variant_id: "B" }),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === "FORBIDDEN_TERM_BOGO")).toBe(true);
      expect(result.violations.some((v) => v.code === "FORBIDDEN_TERM_SAME_ITEM")).toBe(true);
    }
  });

  it("flags exclamation marks in display_offer or variant fields", () => {
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ display_offer: "Buy one latte, get one free!" }),
      variants: [baseVariant({ variant_id: "A" }), baseVariant({ variant_id: "B" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === "EXCLAMATION_MARK")).toBe(true);
    }
  });

  it("flags an invalid offer_type not in the allow-list", () => {
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ offer_type: "percent_off_entire_order" }),
      variants: [baseVariant({ variant_id: "A" }), baseVariant({ variant_id: "B" })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === "OFFER_TYPE_INVALID")).toBe(true);
    }
  });

  it("does not flag a legitimate free-item offer that uses no strong-language vocabulary", () => {
    // "Free pastry with any coffee" matches none of STRONG_LANGUAGE_PATTERNS, but it
    // is a legitimate free-item offer, not a weak one. findWeakDealSignal must not
    // flag the mere absence of strong-language wording (only positive weak signals).
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ offer_type: "free_add_on_with_purchase", display_offer: "Free pastry with any coffee" }),
      variants: [
        baseVariant({ variant_id: "A", headline_en: "Any coffee gets you a free pastry" }),
        baseVariant({ variant_id: "B", headline_en: "Coffee lovers get a free pastry" }),
      ],
    });
    expect(result).toEqual({ ok: true });
  });

  it("flags a second-item discount (e.g. 50% off second pastry) as a weak deal", () => {
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ display_offer: "50% off second pastry" }),
      variants: [
        baseVariant({ variant_id: "A", headline_en: "Half off your second pastry" }),
        baseVariant({ variant_id: "B" }),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === "WEAK_DEAL")).toBe(true);
    }
  });

  it("flags a sub-40% entire-order discount (e.g. 25% off your order) as a weak deal", () => {
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ display_offer: "25% off your order" }),
      variants: [
        baseVariant({ variant_id: "A", headline_en: "Save on your whole order today" }),
        baseVariant({ variant_id: "B" }),
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.code === "WEAK_DEAL")).toBe(true);
    }
  });

  it("does not flag a genuine buy-one-get-one-free deal as weak", () => {
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ display_offer: "Buy one get one free" }),
      variants: [baseVariant({ variant_id: "A", headline_en: "Buy one get one free" }), baseVariant({ variant_id: "B" })],
    });
    expect(result).toEqual({ ok: true });
  });

  it("builds a repair instruction that lists exactly the violations", () => {
    const longHeadline = "A".repeat(COMPOSE_HEADLINE_MAX_CHARS + 1);
    const result = validateComposeOutput({
      offerTypes: OFFER_TYPES,
      offer: baseOffer({ display_offer: "BOGO on lattes!" }),
      variants: [baseVariant({ variant_id: "A", headline_en: longHeadline }), baseVariant({ variant_id: "B" })],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const instruction = formatRepairInstruction(result.violations);
    expect(instruction).toMatch(/^Fix only these issues, keep everything else identical:/);
    for (const v of result.violations) {
      expect(instruction).toContain(v.message);
    }
  });
});
