import { supabase } from "@/lib/supabase";
import type { TabMode } from "@/lib/tab-mode";

export async function fetchAppTabModeForUser(userId: string): Promise<TabMode | null> {
  const { data, error } = await supabase.from("profiles").select("app_tab_mode").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  const raw = data.app_tab_mode;
  if (raw === "business" || raw === "customer") return raw;
  return null;
}

export async function upsertAppTabModeForUser(userId: string, mode: TabMode): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(
    { id: userId, app_tab_mode: mode, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) throw error;
}
