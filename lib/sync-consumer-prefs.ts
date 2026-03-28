import { supabase } from "./supabase";
import { getConsumerPreferences } from "./consumer-preferences";
import { devWarn } from "@/lib/dev-log";

/**
 * Sync the consumer's AsyncStorage notification prefs + last-known coords
 * to `consumer_profiles` in Supabase so the server can target push notifications.
 *
 * Best-effort: never throws. Safe to call on every app launch.
 */
export async function syncConsumerPrefsToServer(
  userId: string | null,
): Promise<void> {
  if (!userId) return;

  try {
    const prefs = await getConsumerPreferences();

    const update: Record<string, unknown> = {
      notification_mode: prefs.notificationPrefs.mode,
      radius_miles: prefs.radiusMiles,
    };

    if (prefs.lastLatitude != null && prefs.lastLongitude != null) {
      update.last_latitude = prefs.lastLatitude;
      update.last_longitude = prefs.lastLongitude;
      update.location_updated_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from("consumer_profiles")
      .update(update)
      .eq("user_id", userId);

    if (error) {
      devWarn("[sync-prefs] Failed:", error.message);
    }
  } catch (err) {
    devWarn("[sync-prefs] Non-fatal error:", err);
  }
}

/**
 * Sync only the location fields. Call after resolving coordinates.
 */
export async function syncConsumerLocationToServer(
  userId: string | null,
  lat: number,
  lng: number,
): Promise<void> {
  if (!userId) return;

  try {
    const { error } = await supabase
      .from("consumer_profiles")
      .update({
        last_latitude: lat,
        last_longitude: lng,
        location_updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (error) {
      devWarn("[sync-prefs] Location sync failed:", error.message);
    }
  } catch (err) {
    devWarn("[sync-prefs] Location sync error:", err);
  }
}
