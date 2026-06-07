import { supabase } from "./supabase";
import { getConsumerPreferences } from "./consumer-preferences";
import { getAlertsEnabled } from "./notifications";
import { devWarn } from "@/lib/dev-log";

function toServerRadiusMiles(radiusMiles: number): number {
  if (!Number.isFinite(radiusMiles)) return 3;
  if (radiusMiles <= 1) return 1;
  if (radiusMiles <= 3) return 3;
  if (radiusMiles <= 5) return 5;
  return 10;
}

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
      // Hosted schema currently allows 1/3/5/10; keep wider local browsing radii
      // from failing the server-side push preference sync.
      radius_miles: toServerRadiusMiles(prefs.radiusMiles),
      deal_alerts_enabled: await getAlertsEnabled(),
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
