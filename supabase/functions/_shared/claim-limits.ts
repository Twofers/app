const DEFAULT_BUSINESS_TZ = "America/Chicago";

function calendarDateKeyInTimeZone(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_BUSINESS_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

export function hasClaimOnLocalBusinessDay(params: {
  now: Date;
  businessTz: string;
  claims: Array<{ created_at: string; claim_status: string | null }>;
}): boolean {
  const todayKey = calendarDateKeyInTimeZone(params.now, params.businessTz);
  return params.claims.some((row) => {
    if (!row.created_at) return false;
    if (row.claim_status === "canceled") return false;
    const key = calendarDateKeyInTimeZone(new Date(row.created_at), params.businessTz);
    return key === todayKey;
  });
}
