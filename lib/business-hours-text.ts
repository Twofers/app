const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/**
 * Separators that mean the weekday is the END of a range or list rather than
 * the start of a new day's entry — "Monday - Friday: 9-5", "Sat & Sun: 8-2".
 * Breaking before those would split one entry across two lines.
 */
const RANGE_TAIL = /(?:[-–—/&,]|\b(?:to|thru|through|and)\b)\s*$/i;

const DAY_ENTRY = new RegExp(`\\b(${WEEKDAYS.join("|")})\\b\\s*:`, "gi");

/**
 * Normalize a hours string into one day per line.
 *
 * Google Places and the website importer both hand back day lists joined by
 * spaces ("Monday: 6:30 AM – 12:00 PM Tuesday: 6:30 AM – 3:00 PM …"), which
 * renders as an unreadable wall of text in the hours box. Only a run-on
 * "<Weekday>:" list is touched: free-form text ("Open late Fri & Sat") and
 * ranges ("Monday - Friday: 9-5") are left exactly as written, and the
 * function is idempotent so re-saving never adds blank lines.
 */
export function formatBusinessHoursText(value: string): string {
  if (!value) return value;
  const collapsed = value.replace(/[ \t]+/g, " ");
  let result = "";
  let lastIndex = 0;
  DAY_ENTRY.lastIndex = 0;
  for (let match = DAY_ENTRY.exec(collapsed); match; match = DAY_ENTRY.exec(collapsed)) {
    const before = collapsed.slice(lastIndex, match.index);
    const preceding = result + before;
    const isStart = preceding.trim() === "";
    const alreadyOnOwnLine = /\n\s*$/.test(preceding);
    const continuesRange = RANGE_TAIL.test(preceding);
    result = preceding + (isStart || alreadyOnOwnLine || continuesRange ? "" : "\n") + match[0];
    lastIndex = match.index + match[0].length;
  }
  result += collapsed.slice(lastIndex);
  return result
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}
