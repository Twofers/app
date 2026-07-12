# Twofer Return Path Phase 1 Report

Date: 2026-07-02. Branch: `release/apple-app-store-readiness-web-billing` (all changes uncommitted, per repo workflow).

## Summary

Phase 1 adds a lightweight return-customer loop on top of the existing favorites, notification-consent, claim, and redemption systems:

1. **Post-claim save-business prompt** — after a successful claim, when the customer closes the QR/ticket modal, they're asked once: "Want to see future offers from this business?" with **Save business / Not now**. Saving inserts into the existing `favorites` table; if deal alerts aren't already enabled, the existing consent-gated alert opt-in runs next (never silently).
2. **Post-redemption save-business prompt** — the wallet detects when one of the customer's active claims transitions to redeemed (both in-app visual pass and staff QR scan) and shows "Enjoyed this deal? Save this business to see future offers." Only if the business isn't already favorited.
3. **Business "Saved customers" metric** — a new SECURITY DEFINER RPC (`business_saved_customers_count`) returns an aggregate favorites count to the owner only. The dashboard shows it as a snapshot tile and inside the insights panel. **Migration applied to production 2026-07-02 with Dan's approval** and verified (see Backend section); the tile itself ships with the next app build.
4. **Truthful "returning" analytics** — the insights label now says "with previous claims" instead of "returning", in all three locales, matching what the RPC actually measures (a prior claim, not a confirmed second visit).
5. **Slow-hours schedule suggestion** — the AI create flow loads `business_slow_hours` (website-signup data) and, when structured rows exist, offers a "Use your slow hours" preset in the recurring schedule presets, plus a nudge line under the Schedule header. Without data, a manual nudge ("target the times you actually want more customers") shows instead. Deal creation is never blocked.
6. **Claim-limit documentation corrected** — the retired "one claim per business per local day" rule was still described as active in three docs; corrected, and a new authoritative `docs/claim-rules.md` documents what is actually enforced and where.

No existing flow was removed or restructured. No new state management. No RLS weakened.

## Files Changed

**New**
- `lib/save-business-prompt.ts` — favorite check/insert helpers (duplicate-insert tolerant) + a 14-day per-business "Not now" cooldown in AsyncStorage.
- `hooks/use-save-business-prompt.tsx` — the prompt state machine (save → optional alert consent → permission-denied/registration-failed info dialogs), built on the existing `BrandedConfirmModal` and the exact consent flow the consumer home already uses.
- `lib/slow-hours-preset.ts` + `lib/slow-hours-preset.test.ts` — converts `business_slow_hours` rows (0–6 Sunday-based days, `time` columns) into a deal-schedule preset (1–7 Monday-based days + minute window); ignores free-text-only rows.
- `supabase/migrations/20260731120000_business_saved_customers_rpc.sql` — aggregate-count RPC, owner/member gated. **Applied to production 2026-07-02** (Dan approved; it was the only pending migration — `supabase db push` dry-run confirmed scope before applying).
- `docs/claim-rules.md` — authoritative claim-rule reference.

**Modified**
- `app/deal/[id].tsx` — flags a pending prompt after a fresh claim; shows the save prompt when the QR modal closes (including via Android back); heart icon updates when saved from the prompt.
- `app/(tabs)/wallet.tsx` — tracks active claim ids across loads and prompts when one becomes redeemed (covers visual-pass and QR/staff-scan redemptions with one code path); skips demo offers; renders the prompt modals.
- `app/(tabs)/dashboard.tsx` — loads `business_saved_customers_count`; new "Saved customers" snapshot tile (hidden while the RPC is unavailable); passes the count to the insights panel.
- `components/merchant-insights-panel.tsx` — optional `savedCustomersCount` line; comment documenting that "repeat" means prior claim, not confirmed return.
- `app/create/ai.tsx` — loads slow-hours data per business, adds the "Use your slow hours" preset chip and the schedule nudge copy.
- `lib/i18n/locales/en.json`, `es.json`, `ko.json` — new `returnPrompt.*`, `offersDashboard.metricSavedCustomers(Sub)`, `merchantInsights.savedCustomers`, `createAi.presetSlowHours` / `slowHoursNudge(Manual)` keys; reworded `merchantInsights.newVsReturning`.
- `docs/beta-release-checklist.md`, `docs/store-release-prep.md`, `docs/TWOFER_GAP_AUDIT.md` — stale claim-rule statements corrected (dated update notes on historical entries; forward-looking checklist text replaced).

Untouched pre-existing local modifications (`android/app/build.gradle`, `app.json`, `s10-live-publish-qa/`) were preserved.

## Existing Systems Reused

- **Favorites**: the original `favorites` table (`UNIQUE(user_id, business_id)`, user-scoped RLS from the initial schema). The prompt inserts exactly the way the deal-detail heart and home-feed toggle do; a 23505 duplicate is treated as success so no duplicates are possible.
- **Notification preferences**: `getAlertsEnabled`/`setAlertsEnabled` (`lib/notifications.ts`) and `setConsumerNotificationPrefs` (`lib/consumer-preferences.ts`), same as the consumer home. Accepting consent sets `mode: "favorites_only"`, identical to the existing favorite-triggered opt-in.
- **Push permissions**: `requestNotificationPermissionsSafe` + `registerPushTokenWithResult` — OS permission is requested only after the user explicitly accepts the consent dialog, and consent is asked at most once per session (same rule as `app/(tabs)/index.tsx`).
- **Claims**: no change to `claim-deal` or claim UX; the prompt piggybacks on the existing success path and fires only after the ticket modal closes so it never delays the QR.
- **Redemptions**: no change to `redeem-token`, `begin/complete visual redeem`, or the staff redemption screens. Detection is purely client-side in the customer's wallet from data it already loads.
- **Dashboard analytics**: same load pattern (`loadMetrics`), same graceful-degradation pattern already used for `deal_claim_counts` (RPC missing → feature hides).
- **Slow-hours data**: `business_slow_hours` from the website-onboarding sync migration, read under its existing member-read RLS policy. No new write paths.

## User Flow After Changes

### Customer Claim Flow
Claim succeeds → QR/ticket modal opens exactly as before (with confetti toast). When the customer dismisses it (Hide button or Android back), if the business is not favorited and hasn't been declined in the last 14 days: the branded prompt "Want to see future offers from this business?" appears. **Save business** adds the favorite (heart icon fills in) and, if deal alerts are off, shows the existing "Get deal alerts?" consent dialog; **Not now** dismisses and starts the 14-day cooldown. Already-favorited businesses never see the prompt.

### Customer Redemption Flow
When a claim the customer was holding becomes redeemed — either by finishing the in-app visual pass or by staff scanning the QR (detected on the next wallet refresh, which the visual flow triggers immediately) — the wallet shows "Enjoyed this deal? Save this business to see future offers." with the same Save/Not-now behavior. Staff redemption screens are untouched; nothing appears on the business device.

### Business Dashboard Flow
Once the migration is applied, the merchant snapshot gains a "Saved customers" tile ("Customers following your offers") and the Audience & timing panel gains "Customers who saved this business: N". It's a count only — no names, no identities. Until the migration is applied the tile simply doesn't render.

### Business Deal Creation Flow
The Schedule step now nudges toward slow periods. If the business has structured slow-hours data (from website signup), the nudge reads "Best for filling slower times — try your slow-hours preset under Recurring," and the recurring presets row gains a "Use your slow hours" chip that fills days + time window in one tap. Without data, the nudge reads "Tip: target the times you actually want more customers. Slower hours work best." Custom scheduling and one-time deals are unchanged, and nothing blocks publishing.

## Backend and RLS Safety

- The only backend change is the new `business_saved_customers_count(uuid)` RPC: SECURITY DEFINER with an explicit owner check (`businesses.owner_id = auth.uid()` or active `business_members` membership, COALESCE-guarded per the RLS-NULL incident rule), `REVOKE FROM PUBLIC/anon`, `GRANT EXECUTE TO authenticated`. It returns a single integer — no user ids, timestamps, or per-customer rows can leak.
- **Migration applied to production 2026-07-02 with Dan's approval** and verified three ways: `supabase migration list` shows `20260731120000` applied; `node scripts/probe-rls-smoke.mjs` passed all 7 checks; a direct RPC probe confirmed the access gate — business owner receives the count (integer only), a non-owner authenticated user gets `403 forbidden` (42501), and anonymous callers get `401`. (Probe note: the smoke test account turned out to own a business, so it doubles as the owner-positive case — it is not a valid "non-owner" subject.)
- Favorites RLS is unchanged: customers still only read/write their own rows; businesses still cannot query the table directly.
- No edge functions changed; nothing was deployed.
- Notifications: no new send paths. Saving a business only makes the customer eligible for the *existing* favorites-based digest/push targeting, which already checks `deal_alerts_enabled` and `push_tokens` (permission-gated).

## Analytics Language Audit

`merchant_deal_insights` / `merchant_business_insights` flag a claim as "returning" when the same user has **any earlier claim** at that business — redeemed or not. That is claim history, not a confirmed return visit. Changes:

- `merchantInsights.newVsReturning` — EN: "Shoppers: {{new}} first-time · {{returning}} returning" → **"Claims: {{new}} first-time · {{returning}} with previous claims"**; ES: "Clientes… que repiten" → "Reclamos… con reclamos previos"; KO: "재방문" (revisit) → "이전 클레임 있는 고객" (customers with previous claims).
- Comment added in `merchant-insights-panel.tsx` so the semantics aren't re-mislabeled later.
- Audited and left as-is (already truthful): "Unique redeemers / Customers with a redeemed claim", "Redeem rate", the dashboard data-coverage card ("new-customer attribution… not estimated here"), and the `claimBlockedReasons` buckets (telemetry categories for legacy server messages, not metric claims).
- Metric logic was not changed — per instructions, this is a labeling fix. A redemption-based "confirmed return visits" metric is Phase 2 work.

## Claim Limit Documentation Audit

What the app actually enforces today (all server-side in `claim-deal` unless noted; full detail in the new `docs/claim-rules.md`):

- Rate limit: 3 claim attempts/user/minute.
- One active claim app-wide per user (race-safe via unique partial index, migration `20260703120005`); re-claiming the same deal idempotently returns the same ticket.
- Business repeat policy (`repeat_claim_policy_type`): NONE (default) / COOLDOWN_DAYS / FOREVER — based only on prior **redemptions** at that business.
- Per-deal `max_claims` counting non-canceled claims (server check + atomic DB trigger, migration `20260704130000`).
- Schedule gates: start/end, claim-cutoff buffer, recurring day/window in the deal's timezone.
- Client-side only: the deal page's pre-rendered "Sold out / Not active / Claim closed" states — advisory mirrors; the server stays authoritative.

Corrected stale statements that described a **"one claim per business per local day"** rule as active: `docs/beta-release-checklist.md` (two spots, dated update notes), `docs/store-release-prep.md` (reviewer caveat rewritten — this one mattered most since it feeds App Store review notes), `docs/TWOFER_GAP_AUDIT.md` (claim-flow row). The "one claim per hour" string in `lib/i18n/api-messages.ts` is a legacy translation mapping only (real limit: 3/min) — documented, left in place as a fallback for old server messages.

## Testing Checklist

Manual QA (Android emulator or device; requires a shopper account + a business with a live deal):

- [ ] **Claim deal as customer** — claim succeeds, QR modal opens, no prompt while the QR is visible.
- [ ] **Claim when business already favorited** — close the QR modal: no prompt.
- [ ] **Claim when business not favorited** — close the QR modal (also test Android back): prompt appears with Save business / Not now.
- [ ] **Redeem deal as customer (visual pass)** — complete slide-to-redeem; after the pass closes, the "Enjoyed this deal?" prompt appears (if not favorited).
- [ ] **Redeem when business already favorited** — no prompt after redemption.
- [ ] **Redeem via staff QR scan** — after staff redeems, pull-to-refresh the wallet (or refocus): prompt appears once.
- [ ] **Favorite from prompt** — tap Save business; deal page heart is filled; business row in Home shows favorited; no duplicate row if tapped twice.
- [ ] **Decline prompt** — tap Not now; claim another deal from the same business: no re-prompt (14-day cooldown); a different business still prompts.
- [ ] **Notification permission already granted + alerts on** — saving from the prompt does NOT show the alerts consent dialog.
- [ ] **Notification permission not granted** — saving shows "Get deal alerts?"; accepting triggers the OS permission dialog; denying OS permission shows the "Turn on notifications" info dialog; declining consent just closes. Verify alerts are never enabled without accepting.
- [ ] **Dashboard favorite count** — (after migration is applied) owner sees "Saved customers" tile and the insights-panel line; count increments after a customer saves; a different business's owner cannot fetch another business's count (RPC returns forbidden).
- [ ] **Dashboard before migration** — tile absent, no error banner.
- [ ] **Slow-hours schedule suggestion** — business with structured `business_slow_hours` rows: nudge mentions the preset; Recurring shows "Use your slow hours" chip; tapping fills days + window; tapping again deselects.
- [ ] **Business with no slow-hours data** — manual tip line shows; no chip; presets otherwise unchanged.
- [ ] **Existing deal creation still works** — publish a one-time and a recurring deal end to end.
- [ ] **Existing wallet redemption still works** — QR modal, short code, visual pass, release deal all behave as before.

Automated: `npm run typecheck` ✅, `npm run lint` ✅, `npm test` → 1121 passed, my new suite (`lib/slow-hours-preset.test.ts`, 6 tests) passes. One **pre-existing, unrelated** failure: `lib/ad-localization-approval-source.test.ts` compares `app/create/ai.tsx` source against `\n` literals and fails on this Windows checkout because git autocrlf materializes the file with CRLF — it fails identically with all my changes stashed (verified). Not introduced by this work; worth normalizing line endings or the test in a follow-up.

## Risks or Follow-Up Work

**Immediate**
- ~~The saved-customers migration needs Dan's approval~~ — **done 2026-07-02**: applied and access-verified. The dashboard tile still requires the next app build to reach devices (the client code that calls the RPC is in this uncommitted source).
- `business_slow_hours` is readable via `is_business_member`, which depends on a `business_members` row. Legacy app-created owners without membership rows will see the manual nudge instead of their data — acceptable (fails honest), but worth a backfill check in Phase 2.
- QR-scan redemption detection requires the customer to reopen/refresh the wallet in the same app session; a redemption that happens entirely while the app is closed won't prompt later (by design, to avoid stale prompts). Phase 2 push automation covers that gap properly.
- CRLF-sensitive source test above.

**Phase 2 candidates (not built, per scope)**
- **Return offers**: a business-configurable "come back within N days" offer auto-surfaced to customers who redeemed.
- **Second-visit automation**: server-side (edge function or cron) follow-up push X days after redemption to opted-in savers — must reuse the `push_tokens` consent gate and `deal_alerts_enabled`.
- **Return-offer notifications**: extend `send-deal-push` / `weekly-deal-digest` targeting with "previously redeemed here" audiences.
- **Redemption-to-return analytics**: a real "confirmed return visits" metric (second redemption at the same business) in `merchant_business_insights` — the honest version of the metric this phase relabeled.
- **Inactive customer targeting**: aggregate "savers with no claim in 30 days" count for owners (aggregate-only, same privacy posture).
- **Per-deal audience rules**: e.g. "savers only" or "past redeemers only" deals — needs claim-deal enforcement plus feed filtering, and interacts with the repeat policy.

---

# Follow-up (2026-07-02): Deal guardrails + confirmed repeat visits

Requested by Dan after Phase 1: duration/quantity guardrails on deal creation and a redemption-confirmed repeat-visit metric.

## What changed

1. **4-hour max deal duration, 1-hour default.** `MAX_DEAL_DURATION_MINUTES = 240` in `lib/deal-schedule-defaults.ts` (the one-time default was already 1 hour). Enforced in `validateInputs()` in `app/create/ai.tsx` — the single publish/edit path all create flows funnel through — for both one-time spans and recurring daily windows, with a clear localized error ("Deals can run for up to 4 hours at a time."). The recurring window default dropped from 2h to 1h. The quick-schedule presets were rewritten to fit the cap (Weekday lunch 11–2, Daily 2–5pm, Weekends 10–2), the slow-hours preset now clamps its window to 4h, and the Schedule help text states the limit up front. Client-side only: existing live deals are untouched, but *editing* a legacy >4h deal now requires shortening it before saving.
2. **Default claim quantity 10** (was 50) — initial value, edit-load fallback, and the placeholder in en/es/ko.
3. **Confirmed repeat visits on the dashboard.** New RPC `business_repeat_visit_stats` (migration `20260801120000`, **applied to production 2026-07-02 with Dan's approval**; dry-run confirmed it was the only pending migration, RLS smoke probe all-pass, and access verified: owner receives aggregates, non-owner 403, anonymous 401): per-business aggregates only — distinct customers with ≥1 redemption, distinct customers with ≥2 redemptions (the "repeat customers"), and redemption totals. Same owner/member gate and privacy posture as `business_saved_customers_count`. Dashboard gains a "Repeat customers / Redeemed 2 or more times" snapshot tile and an insights-panel line ("Confirmed repeat customers: X of Y redeemers came back"); both appear with the next app build (the backend is live). Unlike the claims-based "with previous claims" split, this metric counts actual redemptions — real confirmed returns.

## Files

`lib/deal-schedule-defaults.ts` (+ test), `lib/slow-hours-preset.ts` (+ test), `app/create/ai.tsx`, `lib/merchant-insights.ts` (+ new `parseRepeatVisitStats` test file), `app/(tabs)/dashboard.tsx`, `components/merchant-insights-panel.tsx`, `supabase/migrations/20260801120000_business_repeat_visit_stats.sql`, en/es/ko locales.

## Validation

Typecheck ✅, lint ✅, tests 1128/1128 ✅ (the earlier CRLF-related source-test failure also cleared after the file was rewritten with LF endings).

## Notes / risks

- The 4h cap is client-enforced. A DB-level INSERT guard would be stronger, but adding it now would break deal creation from **existing installed builds** (older defaults allow longer deals), so it should wait until this build is the floor. Flagged for Phase 2.
- Old app builds also keep the old 50-claim default until users update.
- Manual QA additions: create a one-time deal >4h (blocked with error), exactly 4h (allowed), recurring window >4h (blocked); new deal defaults show 1h window and 10 max claims; presets each apply ≤4h windows; repeat-customers tile appears only after the migration is applied and counts only 2+ redemption customers.
