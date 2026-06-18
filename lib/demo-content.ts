export const DEMO_OFFER_LABEL = "Offer unavailable";
export const DEMO_OFFER_SHORT_EXPLANATION = "This offer is no longer available.";
export const DEMO_OFFER_DETAIL_EXPLANATION =
  "This offer is no longer available and cannot be claimed or redeemed.";

type DemoTaggedBusiness = {
  is_demo?: boolean | null;
} | null | undefined;

type DemoTaggedDeal = {
  is_demo?: boolean | null;
  businesses?: DemoTaggedBusiness;
} | null | undefined;

export function isDemoOffer(deal: DemoTaggedDeal): boolean {
  return deal?.is_demo === true || deal?.businesses?.is_demo === true;
}
