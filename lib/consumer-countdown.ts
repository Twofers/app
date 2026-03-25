import { differenceInMinutes, differenceInSeconds } from "date-fns";
import type { TFunction } from "i18next";

export function formatConsumerCountdown(endIso: string, nowMs: number, t: TFunction): string {
  const end = new Date(endIso);
  const now = new Date(nowMs);
  if (!Number.isFinite(end.getTime())) return "";
  if (end.getTime() <= nowMs) return t("dealStatus.expired");

  const totalSec = differenceInSeconds(end, now);
  const mins = differenceInMinutes(end, now);
  if (mins >= 120) {
    const h = Math.floor(mins / 60);
    return t("consumerHome.countdownHours", { count: h });
  }
  if (mins >= 60) {
    return t("consumerHome.countdownOneHour");
  }
  if (mins >= 1) {
    return t("consumerHome.countdownMinutes", { count: mins });
  }
  return t("consumerHome.countdownSeconds", { count: Math.max(1, totalSec) });
}

export function isExpiredAt(endIso: string, nowMs: number): boolean {
  const end = new Date(endIso).getTime();
  return !Number.isFinite(end) || end <= nowMs;
}
