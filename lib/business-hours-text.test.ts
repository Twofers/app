import { describe, expect, it } from "vitest";

import { formatBusinessHoursText } from "./business-hours-text";

describe("formatBusinessHoursText", () => {
  it("splits the run-on Google Places day list one day per line (live S10 repro)", () => {
    // Exact string observed on the Business setup screen 2026-08-07.
    const input =
      "Monday: 6:30 AM – 12:00 PM Tuesday: 6:30 AM – 3:00 PM Wednesday: 6:30 AM – 3:00 PM " +
      "Thursday: 6:30 AM – 3:00 PM Friday: 6:30 AM – 3:00 PM Saturday: 7:00 AM – 3:00 PM " +
      "Sunday: 8:00 AM – 12:00 PM";

    expect(formatBusinessHoursText(input)).toBe(
      [
        "Monday: 6:30 AM – 12:00 PM",
        "Tuesday: 6:30 AM – 3:00 PM",
        "Wednesday: 6:30 AM – 3:00 PM",
        "Thursday: 6:30 AM – 3:00 PM",
        "Friday: 6:30 AM – 3:00 PM",
        "Saturday: 7:00 AM – 3:00 PM",
        "Sunday: 8:00 AM – 12:00 PM",
      ].join("\n"),
    );
  });

  it("is idempotent — re-saving never adds blank lines", () => {
    const once = formatBusinessHoursText("Monday: 9-5 Tuesday: 9-5");
    expect(formatBusinessHoursText(once)).toBe(once);
    expect(once).toBe("Monday: 9-5\nTuesday: 9-5");
  });

  it("keeps weekday RANGES on one line instead of splitting them", () => {
    // "Friday:" ends a range, so breaking before it would corrupt the entry.
    expect(formatBusinessHoursText("Monday - Friday: 9-5")).toBe("Monday - Friday: 9-5");
    expect(formatBusinessHoursText("Monday to Friday: 9-5")).toBe("Monday to Friday: 9-5");
    expect(formatBusinessHoursText("Saturday & Sunday: 8-2")).toBe("Saturday & Sunday: 8-2");
    expect(formatBusinessHoursText("Monday, Tuesday: 7-3")).toBe("Monday, Tuesday: 7-3");
  });

  it("splits a list of ranges at each new entry but keeps each range intact", () => {
    expect(formatBusinessHoursText("Monday - Friday: 9-5 Saturday: 10-2")).toBe(
      "Monday - Friday: 9-5\nSaturday: 10-2",
    );
  });

  it("leaves free-form hours copy untouched", () => {
    expect(formatBusinessHoursText("Open late Fri & Sat")).toBe("Open late Fri & Sat");
    expect(formatBusinessHoursText("Daily 8-8")).toBe("Daily 8-8");
    expect(formatBusinessHoursText("Mon–Fri 9–5")).toBe("Mon–Fri 9–5");
  });

  it("handles empty, whitespace, and case variations safely", () => {
    expect(formatBusinessHoursText("")).toBe("");
    expect(formatBusinessHoursText("   ")).toBe("");
    expect(formatBusinessHoursText("MONDAY: 9-5 tuesday: 9-5")).toBe("MONDAY: 9-5\ntuesday: 9-5");
  });

  it("does not require a space before the colon", () => {
    expect(formatBusinessHoursText("Monday : 9-5 Tuesday : 9-5")).toBe("Monday : 9-5\nTuesday : 9-5");
  });
});
