/**
 * Category-based schedule suggestions for deal creation.
 * Returns smart defaults so first-time users don't have to configure scheduling from scratch.
 */

export type ScheduleSuggestion = {
  isRecurring: true;
  daysOfWeek: number[];
  windowStartMinutes: number;
  windowEndMinutes: number;
  rationale: string;
};

const WEEKDAYS = [1, 2, 3, 4, 5];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const MON_SAT = [1, 2, 3, 4, 5, 6];

function mins(h: number, m = 0) {
  return h * 60 + m;
}

const CATEGORY_SCHEDULES: Record<string, ScheduleSuggestion> = {
  cafe: {
    isRecurring: true,
    daysOfWeek: WEEKDAYS,
    windowStartMinutes: mins(7),
    windowEndMinutes: mins(10),
    rationale: "Most coffee shops see peak traffic 7–10 AM on weekdays.",
  },
  bakery: {
    isRecurring: true,
    daysOfWeek: WEEKDAYS,
    windowStartMinutes: mins(7),
    windowEndMinutes: mins(10),
    rationale: "Bakeries get the morning rush — 7–10 AM weekdays works great.",
  },
  restaurant: {
    isRecurring: true,
    daysOfWeek: WEEKDAYS,
    windowStartMinutes: mins(11),
    windowEndMinutes: mins(14),
    rationale: "Lunch hour deals (11 AM – 2 PM weekdays) drive midday traffic.",
  },
  salon: {
    isRecurring: true,
    daysOfWeek: MON_SAT,
    windowStartMinutes: mins(10),
    windowEndMinutes: mins(16),
    rationale: "Salons fill midday gaps — 10 AM – 4 PM, Mon–Sat.",
  },
  gym: {
    isRecurring: true,
    daysOfWeek: WEEKDAYS,
    windowStartMinutes: mins(6),
    windowEndMinutes: mins(9),
    rationale: "Early birds hit the gym 6–9 AM on weekdays.",
  },
  retail: {
    isRecurring: true,
    daysOfWeek: ALL_DAYS,
    windowStartMinutes: mins(10),
    windowEndMinutes: mins(18),
    rationale: "Retail deals work best during shopping hours, 10 AM – 6 PM daily.",
  },
};

const DEFAULT_SCHEDULE: ScheduleSuggestion = {
  isRecurring: true,
  daysOfWeek: WEEKDAYS,
  windowStartMinutes: mins(9),
  windowEndMinutes: mins(12),
  rationale: "Weekday mornings (9 AM – 12 PM) are a solid default for local deals.",
};

export function getScheduleSuggestion(
  category: string | null | undefined,
): ScheduleSuggestion {
  const key = category?.trim().toLowerCase();
  if (key && key in CATEGORY_SCHEDULES) {
    return CATEGORY_SCHEDULES[key] as ScheduleSuggestion;
  }
  return DEFAULT_SCHEDULE;
}
