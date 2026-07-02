import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";

/**
 * Return-path helpers for the post-claim / post-redemption "save this business"
 * prompt. Uses the existing `favorites` table (UNIQUE(user_id, business_id),
 * owner-scoped RLS) — no new favorites system.
 */

const PROMPT_DISMISSED_KEY_PREFIX = "twoforone_save_biz_prompt_v1_";
/** After "Not now", don't re-ask for the same business for this many days. */
const DECLINE_COOLDOWN_DAYS = 14;

export type SaveBusinessPromptContext = "claim" | "redeem";

/** Returns null when the check itself failed (treat as "don't prompt"). */
export async function isBusinessFavorited(
  userId: string,
  businessId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("favorites")
    .select("business_id")
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return null;
  return Boolean(data);
}

/** Idempotent: a duplicate insert (unique violation) counts as success. */
export async function addBusinessFavorite(userId: string, businessId: string): Promise<boolean> {
  const { error } = await supabase
    .from("favorites")
    .insert({ user_id: userId, business_id: businessId });
  if (!error) return true;
  return error.code === "23505";
}

export async function shouldShowSaveBusinessPrompt(businessId: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(PROMPT_DISMISSED_KEY_PREFIX + businessId);
    if (!raw) return true;
    const dismissedAt = Number(raw);
    if (!Number.isFinite(dismissedAt)) return true;
    return Date.now() - dismissedAt > DECLINE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

export async function recordSaveBusinessPromptDismissed(businessId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPT_DISMISSED_KEY_PREFIX + businessId, String(Date.now()));
  } catch {
    /* best effort */
  }
}
