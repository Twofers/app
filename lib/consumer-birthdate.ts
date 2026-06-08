const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_BIRTHDATE_YEAR = 1900;
const MIN_CONSUMER_AGE_YEARS = 13;

export function defaultConsumerBirthdate(referenceDate = new Date()): Date {
  const d = new Date(referenceDate);
  d.setFullYear(d.getFullYear() - 25);
  d.setHours(12, 0, 0, 0);
  return d;
}

export function latestValidBirthdate(referenceDate = new Date()): Date {
  const d = new Date(referenceDate);
  d.setFullYear(d.getFullYear() - MIN_CONSUMER_AGE_YEARS);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isValidBirthdateIso(s: string, referenceDate = new Date()): boolean {
  const value = s.trim();
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!, 12, 0, 0, 0);
  if (Number.isNaN(dt.getTime())) return false;
  if (dt.getFullYear() !== y || dt.getMonth() !== m! - 1 || dt.getDate() !== d) return false;
  if (dt.getFullYear() < MIN_BIRTHDATE_YEAR) return false;
  if (dt.getTime() > latestValidBirthdate(referenceDate).getTime()) return false;
  return true;
}

export function parseBirthdateIsoToLocalDate(iso: string): Date | null {
  if (!isValidBirthdateIso(iso)) return null;
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, day!, 12, 0, 0, 0);
}

export function toBirthdateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
