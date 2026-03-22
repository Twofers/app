type RecurringInfo = {
  is_recurring?: boolean | null;
  days_of_week?: number[] | null;
  window_start_minutes?: number | null;
  window_end_minutes?: number | null;
  timezone?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

const dayMap: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const dayLabels: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

function getLocalParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { day: dayMap[weekday] ?? 1, minutes: hour * 60 + minute };
}

function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function formatDays(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  if (sorted.join(",") === "1,2,3,4,5") return "Mon–Fri";
  if (sorted.join(",") === "6,7") return "Sat–Sun";
  return sorted.map((d) => dayLabels[d] ?? "Mon").join(", ");
}

export function isDealActiveNow(deal: RecurringInfo) {
  if (!deal) return false;
  const now = new Date();
  const start = deal.start_time ? new Date(deal.start_time) : null;
  const end = deal.end_time ? new Date(deal.end_time) : null;

  if (start && now < start) return false;
  if (end && now >= end) return false;

  if (!deal.is_recurring) return true;

  const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
  const windowStart = deal.window_start_minutes;
  const windowEnd = deal.window_end_minutes;
  const tz = deal.timezone || "America/Chicago";

  if (!days.length || windowStart == null || windowEnd == null || windowStart >= windowEnd) return false;
  const { day, minutes } = getLocalParts(now, tz);
  if (!days.includes(day)) return false;
  return minutes >= windowStart && minutes < windowEnd;
}

export function formatValiditySummary(deal: RecurringInfo) {
  if (!deal) return "Validity unavailable";
  if (deal.is_recurring) {
    const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
    const windowStart = deal.window_start_minutes;
    const windowEnd = deal.window_end_minutes;
    const tz = deal.timezone || "America/Chicago";
    if (!days.length || windowStart == null || windowEnd == null) {
      return "Recurring window";
    }
    return `${formatDays(days)} · ${formatMinutes(windowStart)}–${formatMinutes(windowEnd)} (${tz})`;
  }
  const start = deal.start_time ? new Date(deal.start_time) : null;
  const end = deal.end_time ? new Date(deal.end_time) : null;
  if (start && end) {
    return `${start.toLocaleString()} → ${end.toLocaleString()}`;
  }
  if (end) return `Ends ${end.toLocaleString()}`;
  return "One-time deal";
}
