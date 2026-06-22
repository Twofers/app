import { describe, expect, it } from "vitest";
import {
  TRIAL_ENDING_PUSH_KIND,
  buildTrialEndingPushMessage,
  isTrialEndingPushCandidate,
  resolveTrialReminderLocale,
  trialEndingPushScheduledForIso,
} from "./trial-reminder-push.ts";

const NOW = Date.UTC(2026, 5, 21, 12, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

describe("trial reminder push messages", () => {
  it("builds the required automatic-billing warning in each supported locale", () => {
    const en = buildTrialEndingPushMessage("en");
    expect(en.title).toBe("Trial ends tomorrow");
    expect(en.body).toContain("$30 monthly charge");
    expect(en.body).toContain("plus applicable taxes");
    expect(en.body).toContain("unless you cancel before the trial ends");

    expect(buildTrialEndingPushMessage("es").body).toContain("30 USD");
    expect(buildTrialEndingPushMessage("ko").body).toContain("30달러");
  });

  it("uses the stable event kind consumed by the reminder job", () => {
    expect(TRIAL_ENDING_PUSH_KIND).toBe("trial_ends_24h_push");
  });
});

describe("resolveTrialReminderLocale", () => {
  it("maps supported owner locales and falls back to English", () => {
    expect(resolveTrialReminderLocale("es-419")).toBe("es");
    expect(resolveTrialReminderLocale("KO")).toBe("ko");
    expect(resolveTrialReminderLocale("en")).toBe("en");
    expect(resolveTrialReminderLocale("fr")).toBe("en");
    expect(resolveTrialReminderLocale(null)).toBe("en");
  });
});

describe("isTrialEndingPushCandidate", () => {
  it("selects trials ending within the 23-to-25-hour reminder window", () => {
    expect(isTrialEndingPushCandidate(new Date(NOW + 24 * HOUR_MS).toISOString(), NOW)).toBe(true);
    expect(isTrialEndingPushCandidate(new Date(NOW + 23 * HOUR_MS + 1).toISOString(), NOW)).toBe(true);
    expect(isTrialEndingPushCandidate(new Date(NOW + 25 * HOUR_MS).toISOString(), NOW)).toBe(true);
  });

  it("ignores trials outside the reminder window or with invalid dates", () => {
    expect(isTrialEndingPushCandidate(new Date(NOW + 23 * HOUR_MS).toISOString(), NOW)).toBe(false);
    expect(isTrialEndingPushCandidate(new Date(NOW + 25 * HOUR_MS + 1).toISOString(), NOW)).toBe(false);
    expect(isTrialEndingPushCandidate("not-a-date", NOW)).toBe(false);
    expect(isTrialEndingPushCandidate(null, NOW)).toBe(false);
  });
});

describe("trialEndingPushScheduledForIso", () => {
  it("returns the 24-hour-before timestamp for event audit rows", () => {
    expect(trialEndingPushScheduledForIso("2026-06-22T12:00:00.000Z")).toBe("2026-06-21T12:00:00.000Z");
  });

  it("returns null for invalid dates", () => {
    expect(trialEndingPushScheduledForIso("bad")).toBeNull();
  });
});
