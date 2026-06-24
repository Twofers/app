/**
 * Lightweight product analytics. Logs in dev; swap `forwardToBackend` later for PostHog/Segment/etc.
 */

export type AnalyticsProps = Record<string, string | number | boolean | undefined | null>;

let forwardToBackend: ((event: string, props: AnalyticsProps) => void) | null = null;

/** Optional hook for Phase 2 (e.g. POST to your ingest endpoint). */
export function setAnalyticsSink(fn: (event: string, props: AnalyticsProps) => void) {
  forwardToBackend = fn;
}

export function trackEvent(event: string, props?: AnalyticsProps) {
  const flat: AnalyticsProps = { ...(props ?? {}), ts: Date.now() };
  if (__DEV__) {
    console.log(`[analytics] ${event}`, JSON.stringify(flat));
  }
  try {
    forwardToBackend?.(event, flat);
  } catch {
    /* ignore sink errors */
  }
}

/** AI ad flow — stable names for dashboards */
export const AiAdsEvents = {
  GENERATE_TAPPED: "ai_ads_generate_tapped",
  GENERATION_SUCCEEDED: "ai_ads_generation_succeeded",
  GENERATION_FAILED: "ai_ads_generation_failed",
  REGENERATE_TAPPED: "ai_ads_regenerate_tapped",
  REGENERATE_LIMIT_HIT: "ai_ads_regenerate_limit_hit",
  AD_SELECTED: "ai_ads_ad_selected",
  FIELDS_EDITED_BEFORE_PUBLISH: "ai_ads_fields_edited_before_publish",
  PUBLISHED_WITH_AI_DRAFT: "ai_ads_published_with_ai_draft",
} as const;
