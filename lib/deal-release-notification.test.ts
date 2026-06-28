import { describe, expect, it } from "vitest";

import {
  dealReleaseScheduledFor,
  resolveDealReleaseNotificationState,
} from "./deal-release-notification";

const NOW = Date.parse("2026-06-24T17:00:00.000Z");

describe("deal release notification timing", () => {
  it("treats active deals inside their time window as live", () => {
    expect(
      resolveDealReleaseNotificationState(
        {
          is_active: true,
          start_time: "2026-06-24T16:55:00.000Z",
          end_time: "2026-06-24T18:00:00.000Z",
        },
        NOW,
      ),
    ).toBe("live");
  });

  it("keeps scheduled future deals out of immediate release pushes", () => {
    expect(
      resolveDealReleaseNotificationState(
        {
          is_active: true,
          start_time: "2026-06-24T17:15:00.000Z",
          end_time: "2026-06-24T18:00:00.000Z",
        },
        NOW,
      ),
    ).toBe("upcoming");
  });

  it("does not release-push inactive or ended deals", () => {
    expect(
      resolveDealReleaseNotificationState(
        {
          is_active: false,
          start_time: "2026-06-24T16:00:00.000Z",
          end_time: "2026-06-24T18:00:00.000Z",
        },
        NOW,
      ),
    ).toBe("inactive");

    expect(
      resolveDealReleaseNotificationState(
        {
          is_active: true,
          start_time: "2026-06-24T15:00:00.000Z",
          end_time: "2026-06-24T16:00:00.000Z",
        },
        NOW,
      ),
    ).toBe("ended");
  });

  it("normalizes the scheduled release timestamp", () => {
    expect(dealReleaseScheduledFor({ start_time: "2026-06-24T12:15:00-05:00" })).toBe(
      "2026-06-24T17:15:00.000Z",
    );
  });
});
