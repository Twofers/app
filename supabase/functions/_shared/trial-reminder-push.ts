export type TrialReminderLocale = "en" | "es" | "ko";

export const TRIAL_ENDING_PUSH_KIND = "trial_ends_24h_push";
export const TRIAL_ENDING_PUSH_TARGET_LEAD_HOURS = 24;
export const TRIAL_ENDING_PUSH_MIN_LEAD_HOURS = 23;
export const TRIAL_ENDING_PUSH_MAX_LEAD_HOURS = 25;

const HOUR_MS = 60 * 60 * 1000;

export function resolveTrialReminderLocale(
  preferredLocale: string | null | undefined,
): TrialReminderLocale {
  const value = (preferredLocale ?? "").trim().toLowerCase();
  if (value.startsWith("es")) return "es";
  if (value.startsWith("ko")) return "ko";
  return "en";
}

const TRIAL_ENDING_PUSH_MESSAGES: Record<TrialReminderLocale, { title: string; body: string }> = {
  en: {
    title: "Trial ends tomorrow",
    body:
      "Your Twofer trial ends tomorrow. Your first $30 monthly charge, plus applicable taxes, will occur tomorrow unless you cancel before the trial ends.",
  },
  es: {
    title: "Tu prueba termina manana",
    body:
      "Tu prueba de Twofer termina manana. Tu primer cargo mensual de 30 USD, mas impuestos aplicables, ocurrira manana a menos que canceles antes de que termine la prueba.",
  },
  ko: {
    title: "체험이 내일 종료됩니다",
    body:
      "Twofer 체험이 내일 종료됩니다. 체험 종료 전에 취소하지 않으면 내일 월 30달러와 관련 세금이 첫 결제됩니다.",
  },
};

export function buildTrialEndingPushMessage(
  locale: TrialReminderLocale,
): { title: string; body: string } {
  return TRIAL_ENDING_PUSH_MESSAGES[locale];
}

export function isTrialEndingPushCandidate(
  trialEndsAtIso: string | null | undefined,
  nowMs: number,
): boolean {
  if (!trialEndsAtIso) return false;
  const trialEndsAtMs = Date.parse(trialEndsAtIso);
  if (!Number.isFinite(trialEndsAtMs)) return false;
  const leadHours = (trialEndsAtMs - nowMs) / HOUR_MS;
  return leadHours > TRIAL_ENDING_PUSH_MIN_LEAD_HOURS && leadHours <= TRIAL_ENDING_PUSH_MAX_LEAD_HOURS;
}

export function trialEndingPushScheduledForIso(
  trialEndsAtIso: string,
): string | null {
  const trialEndsAtMs = Date.parse(trialEndsAtIso);
  if (!Number.isFinite(trialEndsAtMs)) return null;
  return new Date(trialEndsAtMs - TRIAL_ENDING_PUSH_TARGET_LEAD_HOURS * HOUR_MS).toISOString();
}
