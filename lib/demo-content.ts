export const DEMO_OFFER_LABEL = "Demo offer";
export const DEMO_OFFER_SHORT_EXPLANATION = "This is sample content for testing only. Not a real offer.";
export const DEMO_OFFER_DETAIL_EXPLANATION =
  "This deal is included so testers can try the app. It is not a real business offer and cannot be redeemed.";

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
