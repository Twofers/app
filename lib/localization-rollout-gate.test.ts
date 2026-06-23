import { describe, expect, it } from "vitest";

import {
  assertLocalizationBroadProductionReady,
  getLocalizationRolloutGateReport,
  getLocaleRolloutGate,
  LOCALE_REVIEW_RECORDS,
} from "./localization-rollout-gate.ts";
import { SUPPORTED_LOCALES } from "./supported-locales.ts";

describe("localization rollout gate", () => {
  it("covers every supported customer locale exactly once", () => {
    const report = getLocalizationRolloutGateReport();

    expect(Object.keys(LOCALE_REVIEW_RECORDS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(report.gates.map((gate) => gate.locale).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it("allows English through the localization-specific review gate", () => {
    const gate = getLocaleRolloutGate("en-US");

    expect(gate.reviewerName).toBe("Dan / Twofer admin");
    expect(gate.nativeReviewStatus).toBe("internal_owner_recorded");
    expect(gate.broadProductionAllowed).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it("blocks U.S. Spanish broad production until reviewer sign-off and screenshot QA are recorded", () => {
    const gate = getLocaleRolloutGate("es-US");

    expect(gate.reviewerName).toBe("TBD");
    expect(gate.broadProductionAllowed).toBe(false);
    expect(gate.blockers.map((blocker) => blocker.code)).toEqual([
      "NATIVE_REVIEWER_TBD",
      "OFFER_TEMPLATE_NATIVE_REVIEW_PENDING",
      "REAL_DEVICE_SCREENSHOT_QA_PENDING",
    ]);
  });

  it("blocks Korean broad production until reviewer sign-off, counter review, and screenshot QA are recorded", () => {
    const gate = getLocaleRolloutGate("ko-KR");

    expect(gate.reviewerName).toBe("TBD");
    expect(gate.broadProductionAllowed).toBe(false);
    expect(gate.blockers.map((blocker) => blocker.code)).toEqual([
      "NATIVE_REVIEWER_TBD",
      "OFFER_TEMPLATE_NATIVE_REVIEW_PENDING",
      "KOREAN_COUNTER_NATIVE_REVIEW_PENDING",
      "REAL_DEVICE_SCREENSHOT_QA_PENDING",
    ]);
  });

  it("throws a concrete rollout summary while non-English locales are blocked", () => {
    expect(() => assertLocalizationBroadProductionReady()).toThrow(
      /es-US: NATIVE_REVIEWER_TBD, OFFER_TEMPLATE_NATIVE_REVIEW_PENDING, REAL_DEVICE_SCREENSHOT_QA_PENDING; ko-KR: NATIVE_REVIEWER_TBD, OFFER_TEMPLATE_NATIVE_REVIEW_PENDING, KOREAN_COUNTER_NATIVE_REVIEW_PENDING, REAL_DEVICE_SCREENSHOT_QA_PENDING/,
    );
  });
});
