import { supabase } from "@/lib/supabase";
import type { TabMode } from "@/lib/tab-mode";

/**
 * FIX: Both functions now catch errors gracefully instead of throwing.
 * The profiles table may not exist yet if the PostgREST schema cache is stale
 * (error: "Could not find the 'app_tab_mode' column of 'profiles'").
 * This prevents logout crashes and auth-landing failures.
 */

export async function fetchAppTabModeForUser(userId: string): Promise<TabMode | null> {
  try {
    const { data, error } = await supabase.from("profiles").select("app_tab_mode").eq("id", userId).maybeSingle();
    if (error || !data) return null;
    const raw = data.app_tab_mode;
    if (raw === "business" || raw === "customer") return raw;
    return null;
  } catch {
    // Table may not exist yet — return null so callers fall back to defaults
    return null;
  }
}

export async function upsertAppTabModeForUser(userId: string, mode: TabMode): Promise<void> {
  try {
    const { error } = await supabase.from("profiles").upsert(
      { id: userId, app_tab_mode: mode, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    if (error) {
      // Log but don't throw — stale schema cache or missing table shouldn't
      // block auth flows like sign-out or sign-in
      console.warn("[profiles-app-mode] upsert failed:", error.message);
    }
  } catch (e) {
    console.warn("[profiles-app-mode] upsert exception:", e);
  }
}
