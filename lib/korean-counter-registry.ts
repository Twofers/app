export type KoreanCounterDefinition = {
  counterId: string;
  display: string;
  applicableCategoryIds: string[];
  examples: string[];
  reviewerApproved: boolean;
  reviewerId: string;
  approvedAt: string;
  version: string;
};

export const KOREAN_COUNTER_REGISTRY_VERSION = "korean-counter-registry-v1-native-reviewed";

export const KOREAN_COUNTER_REGISTRY: KoreanCounterDefinition[] = [
  {
    counterId: "cup",
    display: "잔",
    applicableCategoryIds: ["coffee", "drink", "tea"],
    examples: ["coffee", "latte", "tea"],
    reviewerApproved: true,
    reviewerId: "June",
    approvedAt: "2026-07-03",
    version: KOREAN_COUNTER_REGISTRY_VERSION,
  },
  {
    counterId: "piece",
    display: "개",
    applicableCategoryIds: ["pastry", "retail_item"],
    examples: ["cookie", "muffin", "bagel"],
    reviewerApproved: true,
    reviewerId: "June",
    approvedAt: "2026-07-03",
    version: KOREAN_COUNTER_REGISTRY_VERSION,
  },
  {
    counterId: "serving",
    display: "인분",
    applicableCategoryIds: ["meal"],
    examples: ["lunch plate", "meal"],
    reviewerApproved: true,
    reviewerId: "June",
    approvedAt: "2026-07-03",
    version: KOREAN_COUNTER_REGISTRY_VERSION,
  },
];

export function getReviewedKoreanCounter(counterId: string | null | undefined): KoreanCounterDefinition | null {
  if (!counterId) return null;
  const counter = KOREAN_COUNTER_REGISTRY.find((candidate) => candidate.counterId === counterId);
  return counter?.reviewerApproved ? counter : null;
}
