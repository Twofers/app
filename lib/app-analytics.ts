import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";
import { EDGE_FUNCTION_TIMEOUT_QUICK_MS } from "@/lib/functions";
import { devWarn } from "@/lib/dev-log";

export type AppAnalyticsEventName =
  | "deal_viewed"
  | "deal_opened"
  | "deal_language_switched"
  | "deal_claimed"
  | "wallet_opened"
  | "redeem_started"
  | "redeem_completed"
  | "redeem_failed"
  | "claim_expired"
  | "claim_blocked"
  | "quick_deal_preview_blocked"
  | "quick_deal_release_blocked"
  | "quick_deal_offer_definition_fallback_used"
  | "ai_ad_quality_gate_failed"
  | "ai_ad_versioned_publish"
  // AI ad-copy studio funnel (lib/analytics.ts AiAdsEvents), forwarded to this
  // ingest path by the sink installed in app/_layout.tsx.
  | "ai_ads_generate_tapped"
  | "ai_ads_generation_succeeded"
  | "ai_ads_generation_failed"
  | "ai_ads_regenerate_tapped"
  | "ai_ads_regenerate_limit_hit"
  | "ai_ads_revision_tapped"
  | "ai_ads_revision_succeeded"
  | "ai_ads_revision_failed"
  | "ai_ads_revision_limit_hit"
  | "ai_ads_revision_suggestion_selected"
  | "ai_ads_copy_option_selected"
  | "ai_ads_ad_selected"
  | "ai_ads_composed_preview_shown"
  | "ai_ads_composed_style_changed"
  | "ai_ads_composed_approved"
  | "ai_ads_composed_approval_blocked"
  | "ai_ads_composed_publish_blocked"
  | "ai_ads_fields_edited_before_publish"
  | "ai_ads_published_with_ai_draft";

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
        timeout: EDGE_FUNCTION_TIMEOUT_QUICK_MS,
      });
      if (error) {
        devWarn("[analytics]", error.message ?? error);
        return;
      }
      if (data && typeof data === "object" && "error" in data) {
        devWarn("[analytics]", (data as { error?: string }).error);
      }
    } catch {
      /* ignore */
    }
  })();
}
