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

  it("allows U.S. Spanish after reviewer sign-off and screenshot QA are recorded", () => {
    const gate = getLocaleRolloutGate("es-US");

    expect(gate.reviewerName).toBe("Juan");
    expect(gate.nativeReviewStatus).toBe("native_reviewer_signed_off");
    expect(gate.nativeScreenshotQaStatus).toBe("passed");
    expect(gate.broadProductionAllowed).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it("allows Korean after reviewer sign-off, counter review, and screenshot QA are recorded", () => {
    const gate = getLocaleRolloutGate("ko-KR");

    expect(gate.reviewerName).toBe("June");
    expect(gate.nativeReviewStatus).toBe("native_reviewer_signed_off");
    expect(gate.nativeScreenshotQaStatus).toBe("passed");
    expect(gate.broadProductionAllowed).toBe(true);
    expect(gate.blockers).toEqual([]);
  });

  it("does not throw when every locale has the required localization signoff", () => {
    expect(() => assertLocalizationBroadProductionReady()).not.toThrow();
  });
});
