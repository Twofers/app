import { supabase } from "./supabase";
import { setConsumerZipCode } from "./consumer-preferences";

/** Legacy age bands (onboarding previously used chips). */
export const CONSUMER_AGE_RANGE_VALUES = [
  "under_18",
  "18_24",
  "25_34",
  "35_44",
  "45_54",
  "55_64",
  "65_plus",
] as const;

export type ConsumerAgeRange = (typeof CONSUMER_AGE_RANGE_VALUES)[number];

export type ConsumerProfileRow = {
  user_id: string;
  zip_code: string;
  birthdate: string | null;
  age_range: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidBirthdateIso(s: string): boolean {
  if (!ISO_DATE.test(s.trim())) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  if (Number.isNaN(dt.getTime())) return false;
  if (dt.getFullYear() !== y || dt.getMonth() !== m! - 1 || dt.getDate() !== d!) return false;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (dt.getTime() > today.getTime()) return false;
  if (y! < 1900) return false;
  return true;
}

export function isConsumerProfileComplete(
  row: { zip_code?: string | null; birthdate?: string | null; age_range?: string | null } | null | undefined,
): boolean {
  const zip = row?.zip_code?.trim();
  if (!zip) return false;
  if (row?.birthdate && isValidBirthdateIso(row.birthdate)) return true;
  if (row?.age_range?.trim()) return true;
  return false;
}

export async function fetchConsumerProfile(userId: string): Promise<ConsumerProfileRow | null> {
  const { data, error } = await supabase
    .from("consumer_profiles")
    .select("user_id,zip_code,birthdate,age_range")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ConsumerProfileRow;
}

export async function updateConsumerProfileZip(userId: string, zipCode: string): Promise<void> {
  const zip = zipCode.trim();
  if (!zip) return;
  await supabase
    .from("consumer_profiles")
    .update({ zip_code: zip, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

export async function upsertConsumerProfile(input: {
  userId: string;
  zipCode: string;
  birthdate: string;
}): Promise<{ error: Error | null }> {
  const zip = input.zipCode.trim();
  if (!zip) return { error: new Error("ZIP_REQUIRED") };
  const bd = input.birthdate.trim();
  if (!isValidBirthdateIso(bd)) return { error: new Error("BIRTHDATE_INVALID") };
  const { error } = await supabase.from("consumer_profiles").upsert(
    {
      user_id: input.userId,
      zip_code: zip,
      birthdate: bd,
      age_range: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { error: new Error(error.message) };
  await setConsumerZipCode(zip);
  return { error: null };
}
