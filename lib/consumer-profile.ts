import { supabase } from "./supabase";
import { setConsumerZipCode } from "./consumer-preferences";
import { isValidUsZipFormat, normalizeUsZipInput } from "./us-zip";
import { isValidBirthdateIso } from "./consumer-birthdate";

export { isValidBirthdateIso } from "./consumer-birthdate";

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

export function isConsumerProfileComplete(
  row: { zip_code?: string | null; birthdate?: string | null; age_range?: string | null } | null | undefined,
): boolean {
  // Birthday is optional for v1; only a valid ZIP is required to pass the consumer gate.
  const zip = row?.zip_code?.trim();
  if (!zip) return false;
  return true;
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
  const { error } = await supabase
    .from("consumer_profiles")
    .update({ zip_code: zip, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function upsertConsumerProfile(input: {
  userId: string;
  zipCode: string;
  birthdate?: string;
}): Promise<{ error: Error | null }> {
  const zip = normalizeUsZipInput(input.zipCode);
  if (!zip) return { error: new Error("ZIP_REQUIRED") };
  if (!isValidUsZipFormat(zip)) return { error: new Error("ZIP_FORMAT_INVALID") };
  const bd = input.birthdate?.trim() || null;
  if (bd && !isValidBirthdateIso(bd)) return { error: new Error("BIRTHDATE_INVALID") };
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
