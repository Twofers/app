import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";

const ALERTS_KEY = "deal_alerts_enabled";
const LAST_SEEN_KEY = "last_seen_deals_at";

export async function getAlertsEnabled(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(ALERTS_KEY);
  return val === "true";
}

export async function setAlertsEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(ALERTS_KEY, enabled ? "true" : "false");
}

export async function getLastSeen(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_SEEN_KEY);
}

export async function setLastSeen(value: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_SEEN_KEY, value);
}

export async function checkForNewFavoriteDeals({
  userId,
  favoriteBusinessIds,
}: {
  userId: string;
  favoriteBusinessIds: string[];
}): Promise<void> {
  if (!userId || favoriteBusinessIds.length === 0) return;
  const alertsEnabled = await getAlertsEnabled();
  if (!alertsEnabled) return;

  const lastSeen = await getLastSeen();
  const nowIso = new Date().toISOString();
  if (!lastSeen) {
    await setLastSeen(nowIso);
    return;
  }

  const { count, error } = await supabase
    .from("deals")
    .select("id", { count: "exact", head: true })
    .in("business_id", favoriteBusinessIds)
    .gt("created_at", lastSeen)
    .eq("is_active", true);

  await setLastSeen(nowIso);

  if (error) return;
  if (!count) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "New deals from your favorites",
      body: `${count} new deal${count === 1 ? "" : "s"} just posted.`,
      data: {
        path: "/(tabs)",
      },
    },
    trigger: null,
  });
}
