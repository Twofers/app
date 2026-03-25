import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";

export type AppAnalyticsEventName =
  | "deal_viewed"
  | "deal_opened"
  | "deal_claimed"
  | "wallet_opened"
  | "redeem_started"
  | "redeem_completed"
  | "redeem_failed"
  | "claim_expired";

type Payload = {
  event_name: AppAnalyticsEventName;
  business_id?: string | null;
  deal_id?: string | null;
  claim_id?: string | null;
  context?: Record<string, string | number | boolean | null | undefined>;
};

/**
 * Best-effort analytics (append-only). Never throws; failures are dropped.
 */
export function trackAppAnalyticsEvent(payload: Payload): void {
  void (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("ingest-analytics-event", {
        body: {
          event_name: payload.event_name,
          business_id: payload.business_id ?? null,
          deal_id: payload.deal_id ?? null,
          claim_id: payload.claim_id ?? null,
          context: payload.context ?? {},
          app_version: Constants.expoConfig?.version ?? (Constants as { nativeAppVersion?: string }).nativeAppVersion ?? null,
          device_platform: Platform.OS,
        },
      });
      if (error) {
        console.warn("[analytics]", error.message ?? error);
        return;
      }
      if (data && typeof data === "object" && "error" in data) {
        console.warn("[analytics]", (data as { error?: string }).error);
      }
    } catch {
      /* ignore */
    }
  })();
}
