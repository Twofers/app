import { getReviewedKoreanCounter } from "./korean-counter-registry";
import type { LocalizedOfferTerm } from "./localized-offer-terms";

export type KoreanOfferTemplateResolution = {
  templateId: string;
  templateVersion: string;
  usesCounters: boolean;
  counterFallbackUsed: boolean;
  reasonCodes: string[];
};

export const KOREAN_COUNTER_FREE_FALLBACK_TEMPLATE_ID = "ko-KR.offer.counter-free-fallback";
export const KOREAN_COUNTER_FREE_FALLBACK_TEMPLATE_VERSION = "ko-offer-template-v1-pending-native-review";

export function resolveKoreanOfferTemplate(params: {
  paidTerm: LocalizedOfferTerm;
  rewardTerm?: LocalizedOfferTerm | null;
}): KoreanOfferTemplateResolution {
  const paidCounter = getReviewedKoreanCounter(params.paidTerm.koreanCounterId);
  const rewardCounter = params.rewardTerm ? getReviewedKoreanCounter(params.rewardTerm.koreanCounterId) : paidCounter;
  if (paidCounter && rewardCounter) {
    return {
      templateId: "ko-KR.offer.reviewed-counter",
      templateVersion: paidCounter.version,
      usesCounters: true,
      counterFallbackUsed: false,
      reasonCodes: [],
    };
  }

  return {
    templateId: KOREAN_COUNTER_FREE_FALLBACK_TEMPLATE_ID,
    templateVersion: KOREAN_COUNTER_FREE_FALLBACK_TEMPLATE_VERSION,
    usesCounters: false,
    counterFallbackUsed: true,
    reasonCodes: ["KOREAN_COUNTER_NOT_REVIEWED"],
  };
}
