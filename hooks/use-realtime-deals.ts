import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { isDealActiveNow } from "@/lib/deal-time";
import { devWarn } from "@/lib/dev-log";
import { DEAL_FEED_SELECT, type Deal } from "@/lib/deal-feed-schema";
import type { RealtimeChannel } from "@supabase/supabase-js";

type UseRealtimeDealsOpts = {
  /** Only subscribe when feed is mounted, focused, and showing deals segment. */
  enabled: boolean;
  /** Current deal IDs for dedup — skip deals already in the feed. */
  existingDealIds: Set<string>;
  /** Called with a fully-hydrated Deal when a new one arrives via realtime. */
  onNewDeal: (deal: Deal) => void;
};

/**
 * Subscribes to Supabase Realtime INSERT events on the `deals` table.
 * When a new active deal is inserted, fetches the full row (with business join)
 * and calls `onNewDeal` so the consumer feed can prepend it.
 *
 * Falls back gracefully — if the channel errors or the refetch fails,
 * the existing pull-to-refresh and focus-refresh continue to work.
 */
export function useRealtimeDeals({ enabled, existingDealIds, onNewDeal }: UseRealtimeDealsOpts): void {
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Refs to avoid re-subscribing when callbacks/sets change identity.
  const existingIdsRef = useRef(existingDealIds);
  existingIdsRef.current = existingDealIds;
  const onNewDealRef = useRef(onNewDeal);
  onNewDealRef.current = onNewDeal;

  useEffect(() => {
    if (!enabled) {
      // Tear down any existing channel when disabled.
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    const channel = supabase
      .channel("consumer-deals-feed")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "deals",
          filter: "is_active=eq.true",
        },
        async (payload) => {
          try {
            const newRow = payload.new as { id?: string } | undefined;
            const dealId = newRow?.id;
            if (!dealId) return;

            // Dedup: skip if we already have this deal in the feed.
            if (existingIdsRef.current.has(dealId)) return;

            // Fetch the full deal with business join (same shape as loadDeals).
            const { data, error } = await supabase
              .from("deals")
              .select(DEAL_FEED_SELECT)
              .eq("id", dealId)
              .maybeSingle();

            if (error || !data) return; // RLS filtered it out, or already expired.

            const deal = data as unknown as Deal;
            if (!isDealActiveNow(deal)) return;

            // Final dedup check (state may have changed while we were fetching).
            if (existingIdsRef.current.has(deal.id)) return;

            onNewDealRef.current(deal);
          } catch {
            // Non-fatal: polling will pick it up on next refresh.
          }
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          devWarn("[realtime] deals channel error:", status);
          // Clean up the failed channel to avoid leaked subscriptions.
          supabase.removeChannel(channel);
          channelRef.current = null;
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [enabled]);
}
