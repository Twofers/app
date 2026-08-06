# Consumer cold-start — close the four residual gaps

Date: 2026-08-06
Status: APPROVED to implement (Dan directive 2026-08-06: top-3 improvements batch); workstream D is design-only pending a founder decision.
Convention: this plan file IS the tracker; check items off as they land.

## Context

The June P0-2 ("day-one users see no deals, no notify-me path") is mostly
solved: 2-step onboarding with a favorite-shops step (`app/onboarding.tsx:62`,
shops list :88-128 via `nearby_businesses` with no deal filter), favorites
push on publish (`supabase/functions/send-deal-push/index.ts:237-344`), weekly
digest cron (`20260708150000_weekly_digest_cron.sql:53-71`, Sat 17:00 UTC),
and a "save this shop to hear when one posts" pitch on business pages
(`app/business/[id].tsx:802-809`).

Four gaps remain, all hitting the newest users hardest. Verified 2026-08-06:

**GAP A — opting into alerts DOWNGRADES a cold-start user.**
`enableDealAlerts` (`app/(tabs)/index.tsx:684`) force-sets
`setConsumerNotificationPrefs({ v: 1, mode: "favorites_only" })`, but the
default mode is `all_nearby` (`lib/consumer-preferences.ts:45`). A new user
with zero favorites who accepts the alerts prompt ends up subscribed to
nothing at all.

**GAP B — the emptiest feed gets the weakest empty state.** The rich empty
state (widen radius / view all / favorite hint, index.tsx:1660-1711) only
renders when `searchFilteredDeals.length > 0` (`emptyNearbyLive`,
index.tsx:1000-1001) — i.e. deals exist somewhere but not in radius. With
truly ZERO live deals (the real day-one case) the generic
`ListEmptyComponent` (index.tsx:1865-1888) shows "No live deals — check back
soon" with no follow CTA, no notify-me, no digest opt-in.

**GAP C — dead demand-capture endpoint.**
`supabase/functions/request-business-on-twofer/index.ts` (123 lines) is
deployed and referenced in config/docs, but has **no client caller anywhere**
in app/, components/, lib/, or website/.

**GAP D — no realtime area push.** `send-deal-push` targets favorites only;
`all_nearby` users get area coverage only from the weekly digest and the
on-focus local check (`lib/notifications.ts:186-230`).

## Workstream A — stop the alerts-mode downgrade (client, 1 line class)

- [x] `enableDealAlerts` must preserve the user's current mode: read prefs
      first; only set `deal_alerts_enabled`/consent fields, never overwrite
      `mode` when one exists; a genuinely unset mode keeps the `all_nearby`
      default. Inspect `lib/consumer-preferences.ts` for the actual shape
      before editing — do not guess field names.
- [x] Unit test: enabling alerts with mode `all_nearby` keeps `all_nearby`;
      with no stored prefs keeps the default; with `favorites_only` keeps
      `favorites_only`.

## Workstream B — zero-deals empty state carries the growth CTAs (client)

- [x] When the deals segment has zero live deals overall, render the rich
      empty state (or an equivalent branch), not the generic one: primary
      action switches to the Shops segment ("Save shops to hear when deals
      post"), secondary offers the deal-alerts opt-in if not yet enabled
      (reusing `maybeOfferDealAlerts` / the branded confirm — never
      Alert.alert).
- [x] Keep copy minimal, new i18n keys in ALL THREE locales (en/es/ko);
      CI `check:i18n-keys` gates missing keys and `defaultValue` masks them
      at runtime — add every key everywhere.
- [x] Source test pinning the branch condition (zero-deals → rich empty
      state), modeled on existing index source tests if present.

## Workstream C — wire up "request a business" (client)

- [x] Read `supabase/functions/request-business-on-twofer/index.ts` for the
      exact contract (auth requirement, payload, rate limits) before writing
      the caller.
- [x] Entry points (both low-key, few words): a footer row on the Shops
      segment list and a secondary line on the zero-deals empty state —
      "Don't see your spot? Request it."
- [x] Minimal sheet/modal: business name (required), optional note; submit
      via `lib/functions.ts`-style wrapper; success state is a one-line
      confirmation. Branded modal, not Alert.alert.
      DEVIATION: the deployed function only accepts an existing
      `business_id`/`prospect_id` (UUID), never free text, and has no note
      field — see `record_business_demand_signal` in
      `20260802120000_business_prospect_command_center.sql`. Built as a
      search-and-select sheet instead (search via the also-dead
      `public-local-businesses` function, tap a result, confirm); dropped
      the "optional note" field since the server has nowhere to put it.
- [x] Disable the submit button while in flight (double-submit trap — same
      class as the known business-apply F-08).
- [x] i18n keys in en/es/ko + unit test for the wrapper.

## Workstream D — realtime area push (DESIGN ONLY this batch)

Blocked on a real decision: server-side "deal published near you" requires
storing last-known coordinates server-side (privacy + schema change) or a
geo-topic subscription scheme. Options, roughly in order of preference:

1. Store coarse geohash (~5km cell) per push token, opt-in, updated on app
   focus; `send-deal-push` adds an `all_nearby` audience = tokens whose cell
   is within deal radius. Flag-gated (`push_all_nearby`, default OFF).
2. Expand the weekly digest to 2–3×/week for `all_nearby` users (no schema
   change, weaker).
3. Do nothing; rely on Workstream B funneling users into favorites.

- [ ] Founder decision recorded here; implementation gets its own checklist
      when chosen. No code in this batch.

## Founder gates

- A–C are client-only → next store build (no OTA). No migrations, no edge
  function changes, no deploys needed this batch.
- D: decision + (if option 1) a migration and `send-deal-push` deploy later.
