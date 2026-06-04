# Agent Rules

## Token Conservation Rules

- Claude gets one task at a time.
- Do not send Claude the entire `TASK_QUEUE.md`.
- Send only the current task and acceptance criteria.
- Inspect only files related to the current task.
- Make the smallest safe change.
- Do not work on future tasks.
- Do not start Expo unless explicitly required.
- Do not run full builds unless explicitly required.
- Return only:
  - files changed
  - summary of changes
  - blockers

## Review Rules

- Codex reviews all changes.
- Codex inspects `git diff`.
- Codex runs validation.
- Codex decides whether a task is complete.
- Claude does not self-approve tasks.

Maximum scope per task:
- Do not modify more than 5 files without stopping.
- Do not investigate future tasks.
- Complete one task, validate, then stop.

If a task requires discovery:
- Identify candidate files once.
- Do not perform repeated repository-wide searches.
- Move immediately to implementation.

# TWOFER Task Queue

This file is the working queue for polishing TWOFER until it feels like a company-grade beta. Claude Code should use this as the source of truth for what to build next, what "done" means, and what to report back.

## Manager Notes

- Dan is the product owner. Codex is acting as manager/reviewer. Claude Code is implementing.
- Do not skip ahead without a clear reason. Work the queue in order.
- Tasks 1-3 are already active. Keep their commits scoped and easy to review.
- Do not rewrite navigation, Supabase logic, or shared architecture unless the task truly requires it.
- Preserve:
  - TWOFER name in all caps.
  - TWOFER orange `#FF9F1C`.
  - Penguin mascot.
  - Strong-deal guardrail.
  - Auth/RLS safety.
  - Existing Reanimated deal-card and toast animations.
- Follow `AGENTS.md`:
  - Never touch more than 3 files without testing in between.
  - Android is the primary test target.
  - Show friendly errors, never raw error objects.
- Validation rules:
  - For docs-only edits, verify only that the file was created or updated, then run `git diff --stat` and `git diff`.
  - For code edits, run `npx tsc --noEmit` and `npm run lint` if available.
  - Run `npx expo start` only when the task changes runtime app behavior and a manual UI check is needed.
  - Run `npx expo prebuild` or EAS build only during final release validation.
- Do not commit:
  - `claude-history-export/`
  - `project-knowledge/`
  - `.codex/`
  - `.env`
  - build artifacts
  - APK files
  - `qa-screens/`
  - untracked diagnostic files

## Reporting Format

After each task, report:

1. Commit SHA, or say explicitly if uncommitted.
2. Exact files changed.
3. What was fixed.
4. What was intentionally left alone.
5. Verification run:
   - typecheck
   - lint
   - vitest if relevant
   - `npx expo start` only if runtime behavior changed and a manual UI check is needed
   - Android smoke if available
6. Screenshots captured, if available.
7. Any remaining known issues.

## Commit Guidance

- Prefer one small commit per task.
- Do not mix copy cleanup, UI modal conversion, flow changes, analytics, and release tooling in one commit.
- If a task requires more than one commit, keep each commit independently understandable.
- If a task touches locale files, keep `en`, `es`, and `ko` keys in sync.

## Claude Limit Handling

- If Claude Code returns a usage-limit, rate-limit, quota, overloaded, or retry-later error, stop the current task immediately.
- Do not mark the task complete.
- Record the failed task and timestamp in this file before pausing.
- Wait 60 minutes before retrying.
- Retry the same task with a shorter prompt.
- Do not retry more than once per hour.

### Claude Retry Log

- No Claude limit failures recorded yet.

---

## Task 1 - Production UI Cleanup

Status: Active / in progress.

Task: Make the beta UI production-clean.

Remove or dev-gate anything that makes TWOFER feel like a test app:

- Visible demo credentials.
- "Demo" business/user language unless the account is truly demo-only.
- Debug/test/internal copy.
- Raw error objects.
- Raw IDs.
- Placeholder-looking labels.

Acceptance:

- Production build shows no demo login/password helper.
- User-facing errors are friendly and actionable.
- No internal/debug/test wording appears in consumer or business production flows.
- Demo-only copy is allowed only when gated to the real demo account or dev/preview builds.

Verification:

- Run typecheck.
- Run lint.
- Run vitest if locale/message tests exist.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Android smoke: auth, home, shops, settings, business create flow.
- Capture fresh screenshots of auth, home, shops, and settings if possible.

Expected report:

- List every production-facing string changed.
- List demo/debug surfaces that were inspected and confirmed gated.
- Confirm no production EAS profile enables demo/debug flags.

---

## Task 2 - App-Wide Branded Confirmations

Status: Complete / validated 2026-06-03.

Task: Replace native/system-looking confirmation alerts in core flows with TWOFER-branded confirmations.

Use the existing branded confirm modal pattern or a small reusable wrapper around it. Replace `Alert.alert` where it affects core UX:

- Sign out.
- Delete account.
- Notification permission explanations.
- Destructive/cancel actions.
- Deal pause/resume/end/delete confirmations.
- Draft discard confirmations.
- Wallet/redeem close confirmations.

Acceptance:

- No teal native buttons in core flows.
- Primary action uses TWOFER orange `#FF9F1C`.
- Secondary action is neutral outline/text.
- Behavior remains identical to the old confirmation.
- Modal supports localized title/message/action labels.
- Modal layering works on Android, especially if used above wallet/redeem passes.

Verification:

- Search for remaining `Alert.alert` call sites.
- Explain every remaining native alert and why it is intentionally left.
- Run typecheck.
- Run lint.
- Run vitest if relevant.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Android smoke each replaced flow if possible.
- Capture screenshots for representative modals:
  - sign out
  - notification permission
  - delete/destructive action
  - discard draft
  - wallet/redeem close

Expected report:

- Files converted.
- Confirmation that action behavior did not change.
- Remaining native alert inventory.

Findings 2026-06-03:

- Core confirmation flows inspected: sign out/delete account, notification permission explanations, deal lifecycle pause/resume/end/bulk delete, AI draft discard, and wallet pass early close all use `useBrandedConfirm`/`BrandedConfirmModal`.
- Remaining native `Alert.alert` calls are intentionally left in `app/(tabs)/dashboard.tsx` and `app/deal-analytics/[id].tsx`; both are 3-button export format choosers (`Cancel`/`CSV`/`PDF`), not confirmation flows, and the current branded confirm modal supports one primary action plus an optional neutral secondary action.
- No code changes were required for Task 2 in this pass; validation was run with `npm run typecheck` and `npm run lint`.

---

## Task 3 - Loading, Empty, And Error States

Status: Active / in progress.

Task: Polish loading, empty, and error states across the main app.

Screens to cover:

- Home Deals.
- Shops.
- Map.
- Wallet.
- Settings.
- Business dashboard.
- Create deal.
- Claim/redeem.

Acceptance:

- No blank white screens while loading.
- Every empty state has a clear message and one next action.
- Every error state is friendly and has retry/go-back guidance.
- No raw Supabase/network errors are shown to users.
- States look polished on Android small and larger screens.
- Empty states do not imply incorrect filtering. For example, Deals can reference the user's radius; Shops should not imply the Deals radius applies if Shops is metro-wide.

Verification:

- Force empty states where possible.
- Force offline/network error where reasonable.
- Run typecheck.
- Run lint.
- Run vitest if relevant.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Capture screenshots for each major state where practical.

Expected report:

- Which screens got loading states.
- Which screens got empty states.
- Which screens got error states.
- Any states that could not be triggered and why.

Findings 2026-06-03:

- Scoped pass completed for Home Deals, Wallet, and Settings only; Shops, Map, Business dashboard, Create deal, and Claim/redeem were intentionally left for later Task 3 work.
- Home Deals now keeps the existing skeleton/banner states and adds a retry action to the no-deals empty state when there are no shops available to browse.
- Wallet load now catches unexpected stale-redeem or query failures, keeps users on a friendly retry state, and gives the empty wallet a "Browse Offers" next action.
- Settings now shows an explicit loading card, a friendly retryable load error state, and friendly dialogs for failed preference/location/locale/sign-out saves instead of silent failures or raw messages.
- Validation passed with `npm run typecheck` and `npm run lint`; empty/offline states were not manually forced in Expo during this scoped pass.

---

## Task 4 - Auth And Onboarding Polish

Status: Completed.

Completed notes:

- Polished auth spacing, mascot presentation, role card states, CTA hierarchy, keyboard scroll room, and legal link tap targets.
- Clarified consumer ZIP setup and onboarding ZIP/radius purpose copy.
- Verified with `npm run typecheck` and `npm run lint`.

Task: Make auth and onboarding feel premium and stable on Android.

Improve:

- Spacing around mascot, TWOFER title, language selector, and role cards.
- Selected, pressed, focused, and disabled account card states.
- Login/create account button balance.
- Keyboard behavior.
- Legal link tap targets.
- ZIP/radius onboarding clarity.
- Business vs consumer copy clarity.

Acceptance:

- No clipped text on small Android.
- Keyboard never hides the active input or primary button.
- Role card selected state looks clean and intentional.
- Press feedback never washes over text.
- Auth screen feels production-ready, not demo-like.
- Onboarding makes it obvious why ZIP/radius are requested.

Verification:

- Run typecheck.
- Run lint.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Android screenshots:
  - initial auth
  - scrolled auth
  - keyboard open
  - consumer selected
  - business selected
  - onboarding ZIP/radius

---

## Task 5 - Deal And Shop Card Polish

Status: Complete / validated 2026-06-03.

Task: Make deal/shop cards feel like a real marketplace.

Improve card hierarchy:

- Business name.
- Deal status/title.
- Distance/city.
- Favorite heart.
- Claim/live/no-live-deal state.
- Logo/photo fallback.
- Pressed state.
- Long-name handling.

Acceptance:

- Cards are scannable in under 2 seconds.
- Long names do not break layout.
- Missing photos/logos still look polished.
- Favorite heart responds immediately with clear visual feedback.
- Pressed states feel intentional.
- No card content overlaps at common Android sizes.

Verification:

- Run typecheck.
- Run lint.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Android screenshots:
  - long business name
  - missing photo/logo
  - no live deal
  - live deal
  - favorited and unfavorited

Findings 2026-06-03:

- Home deal cards now show clearer marketplace hierarchy: business name, live/claimed/redeemed/expired badge, distance/city metadata, deal title, description, and a clearer time/status row.
- Deal-card favorite hearts now use a fixed 44px touch target, visible selected border/background, accessibility selected state, and the existing optimistic favorite update remains unchanged.
- Deal-card missing-photo fallback now uses branded orange treatment with cafe icon, business initial, and business name instead of a plain blank placeholder.
- Shop cards now include a branded storefront/initial fallback tile, stronger card border/pressed state, clearer distance/address styling, live/no-live deal pills, and fixed favorite-heart target.
- Preserved business logic, claim logic, favorite persistence, analytics, navigation behavior, onboarding, billing, dashboard, and auth screens.
- Validation passed with `npm run typecheck` and `npm run lint`; Expo/manual Android screenshots were not captured in this pass.

---

## Task 6 - Shop Detail Screen

Status: Completed.

Task: Add or polish a real shop detail screen.

When a user taps a shop, show:

- Shop name.
- Logo/photo fallback.
- Address.
- Distance.
- Active deals.
- Favorite button.
- Directions/map action if available.
- "How redemption works" copy.
- Empty state if the shop has no live deals.

Acceptance:

- Tapping a shop opens a real detail view.
- User understands whether the shop has a live deal.
- User can favorite/unfavorite from detail.
- Layout works with missing data.
- Back navigation is predictable.
- The screen is localized if existing surrounding copy is localized.

Verification:

- Run typecheck. Passed: `npm run typecheck`.
- Run lint. Passed: `npm run lint`.
- Run vitest if navigation/data tests are added.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Android smoke from Shops list to detail and back.
- Screenshots:
  - shop with deal
  - shop without deal
  - favorited state
  - missing logo/photo fallback

Findings:

- Existing `/business/[id]` route was present, so Task 6 was a focused polish pass rather than new navigation.
- Business detail now shows a larger logo/fallback hero, clearer favorite state, visible address/directions card, optional distance when opened from the consumer feed, active deal cards, no-live-deal empty state, and localized redemption guidance using existing wallet copy.
- Claim flow, deal detail navigation, analytics, billing, onboarding, and dashboard behavior were not changed.

Validation results:

- `npm run typecheck` passed.
- `npm run lint` passed.
- Vitest was not run because no tests were added.
- Expo/Android smoke was not run in this pass; manual smoke should verify Shops list to detail and back, favorited state, missing-logo fallback, and shop with/without live deals.

---

## Task 7 - Claim And Redeem Flow Polish

Status: Complete / validated 2026-06-03.

Task: Polish the claim/redeem money moment.

Improve:

- Claim confirmation.
- Wallet ticket design.
- QR display.
- Expiration/status clarity.
- Redeemed/expired/already-claimed states.
- Staff-facing redemption clarity.
- Double-tap protection.

Acceptance:

- User always knows if a ticket is active, expired, redeemed, or already claimed.
- Staff can understand what to scan/show without training.
- Double taps do not create duplicate or confusing states.
- Success state feels polished and branded.
- Failure states are friendly and actionable.

Verification:

- Run typecheck.
- Run lint.
- Run vitest if claim/redeem logic changes.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Android smoke claim -> wallet -> redeem.
- Screenshots:
  - claim success
  - active wallet ticket
  - QR
  - redeemed
  - expired/already-used if test data allows

Findings 2026-06-03:

- Claim QR confirmation now uses localized copy, keeps the existing branded animation, shows an active/expired badge, frames the QR in TWOFER orange, and gives staff-facing verification guidance.
- Wallet tickets now make the active money moment clearer with scan-at-counter treatment, visible claim code, single-use/expiration note, clearer busy state text, and disabled backup QR while a redemption action is already busy.
- Wallet QR display now uses orange active-state treatment, scan-at-counter guidance, branded QR frame, and disables QR refresh while refresh is already in progress.
- Merchant redeem now has ref-level processing protection for scan/manual redemption, disables scan/manual mode switching while processing, and shows a more branded redemption success receipt.
- Preserved Supabase claim/redeem calls, analytics events, billing, onboarding, dashboard, auth, deal claiming rules, and navigation behavior.

Validation results:

- `npm run typecheck` passed.
- `npm run lint` passed.
- Vitest was not run because Supabase claim/redeem business logic was not changed.
- Expo/Android smoke and screenshots were not run in this pass; manual smoke should verify claim success, active wallet ticket, QR backup, redeemed success, and expired/already-used states if test data allows.

---

## Task 8 - Business Create Deal Polish

Status: Implemented - code validation passed; manual Android screenshots pending.

Task: Make business deal creation feel guided and professional.

Improve:

- Inline validation messages.
- Deal preview before publish.
- Clear explanation of strong BOGO requirement.
- Publish success state.
- "View live deal" action after publish.

Do not weaken strong-deal validation.

Acceptance:

- Merchant can create a valid deal without guessing.
- Weak deals are rejected with friendly, specific guidance.
- Published deal can be viewed immediately.
- Strong-deal client and server guardrails remain intact.
- Long merchant-entered text does not break layout.

Verification:

- Run typecheck.
- Run lint.
- Run vitest if strong-deal or creation tests exist.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Test strong deal accepted.
- Test weak deal rejected.
- Screenshots:
  - form
  - validation
  - preview
  - success

Findings:

1. What I found
   - Quick create already used the existing client strong-deal checks before insert.
   - The screen published immediately after validation, so merchants had no customer-card preview or post-publish success state.
   - Weak or incomplete edits were mostly surfaced through a top banner, not inline near the fields.
2. Why it matters
   - Merchants had to guess the exact strong-offer wording, and published deals could not be opened directly from the publish result.
3. Recommended fix
   - Added inline headline/offer validation, strong TWOFER guidance, a required preview step before publish, and a post-publish success state with View live deal.
   - Strong-deal validation was not weakened; publish still runs `assessDealQuality` and `validateStrongDealOnly` before insert.
4. Files affected
   - `app/create/quick.tsx`
   - `components/deal-preview-modal.tsx`
5. MVP priority: High

Validation results:

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npx vitest run lib/strong-deal-guard.test.ts lib/deal-quality.english-regression.test.ts lib/menu-offer.test.ts` - passed, 49 tests.
- `npx expo start` and screenshots were not run in this pass; manual Android screenshots remain for form, validation, preview, and success.

---

## Task 9 - Business Dashboard Polish

Status: Implemented - code validation passed; manual Android screenshots pending.

Task: Make the business dashboard feel like a real merchant tool.

Show clearly:

- Live deals.
- Claims.
- Redemptions.
- Simple conversion/engagement metric if available.
- Empty state for new businesses.
- Last updated indicator.
- Clear next action.

Acceptance:

- A founding cafe can understand whether TWOFER is working.
- Empty dashboard tells them exactly what to do next.
- Metrics do not overpromise if data is limited.
- Deal management actions are clear and use branded confirmations.

Verification:

- Run typecheck.
- Run lint.
- Run vitest if dashboard calculations change.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Screenshots:
  - empty dashboard
  - dashboard with data
  - live deal visible
  - deal action menu/confirmation

Findings:

1. What I found
   - The dashboard already loaded real month-to-date claims, redemptions, deal opens, per-deal conversion, and deal status data.
   - The first screen did not summarize live deals or show when the data last refreshed.
   - The empty state was generic, and filtered-empty results used the same message as a brand-new business.
   - The dashboard included a hardcoded inventory-saved estimate that was not backed by current data.
2. Why it matters
   - Founding cafes need to know quickly whether a live offer exists and whether customers are claiming or redeeming it.
   - Fake or implied metrics can reduce trust when the app only has TWOFER activity data.
3. Recommended fix
   - Added a merchant snapshot with live deal count, claims, redemptions, conservative engagement, last updated time, and one clear next action.
   - Improved live deal cards with stronger live treatment and labeled claim/redeem/redeem-rate pills.
   - Added a first-deal empty state with explicit next steps and a separate clear-filters state.
   - Replaced the hardcoded inventory estimate with a data-coverage note.
4. Files affected
   - `app/(tabs)/dashboard.tsx`
5. MVP priority: High

Validation results:

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- Vitest was not run because dashboard calculations were not changed.
- `npx expo start` and screenshots were not run in this pass; manual Android screenshots remain for empty dashboard, dashboard with data, live deal visible, and deal action menu/confirmation.

---

## Task 10 - Analytics And Crash Monitoring

Status: Implemented - code validation passed; provider event smoke pending.

Task: Add company-grade observability.

Add analytics events for:

- `app_opened`
- `signup_started`
- `signup_completed`
- `role_selected`
- `onboarding_completed`
- `location_permission_allowed`
- `location_permission_denied`
- `deal_viewed`
- `shop_viewed`
- `favorite_added`
- `favorite_removed`
- `alert_opt_in_accepted`
- `alert_opt_in_declined`
- `deal_claimed`
- `deal_redeemed`
- `business_deal_created`

Add crash/error monitoring with release/version context.

Acceptance:

- We can answer where users drop off.
- Production crashes are visible by app version/build.
- No secrets or unnecessary PII are logged.
- Event names are consistent and documented.
- Analytics calls fail safely and never block user flows.

Verification:

- Run typecheck.
- Run lint.
- Run vitest if wrappers are tested.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Show event names and where fired.
- Show test event evidence from the chosen tool/provider.
- Confirm source maps/release config if crash monitoring supports it.

Findings 2026-06-03:

1. What I found
   - Existing analytics used `app_analytics_events` through `ingest-analytics-event`, but the edge allowlist only accepted the older deal/wallet/redeem events.
   - Pre-auth funnel events such as `app_opened`, `signup_started`, and `signup_completed` could not be recorded because the ingest function required an authenticated user before reading the event name.
   - There was no crash/error telemetry path carrying app version/build context.
2. Why it matters
   - The pilot needs drop-off visibility across app open, signup, onboarding, favorites, alerts, shop views, deal creation, claims, and redemption.
   - Production crashes need to be visible by app version/build without logging raw errors, tokens, emails, addresses, ZIP coordinates, or full URLs.
3. Recommended fix
   - Added best-effort Supabase network observability in `lib/supabase.ts` for `app_opened`, `signup_started`, `signup_completed`, `role_selected`, `shop_viewed`, `favorite_added`, `favorite_removed`, `alert_opt_in_accepted`, `alert_opt_in_declined`, `deal_redeemed`, and `business_deal_created`.
   - Preserved existing `deal_viewed` and `deal_claimed` call sites and added explicit onboarding tracking for `onboarding_completed`, `location_permission_allowed`, and `location_permission_denied`.
   - Expanded `ingest-analytics-event` to document/allow the Task 10 event names, permit safe pre-auth events with `user_id = null`, and sanitize context server-side.
   - Added `app_error` crash/error monitoring through React Native `ErrorUtils` with `app_version`, `device_platform`, `app_build`, `fatal`, `error_name`, and a non-PII `error_hash`.
4. Files affected
   - `lib/supabase.ts`
   - `supabase/functions/ingest-analytics-event/index.ts`
   - `app/onboarding.tsx`
5. MVP priority: High

Event map:

- `app_opened`: `lib/supabase.ts` module initialization.
- `signup_started`, `signup_completed`: Supabase auth signup request/response observed in `lib/supabase.ts`.
- `role_selected`: `profiles.app_tab_mode` upsert observed in `lib/supabase.ts`.
- `onboarding_completed`, `location_permission_allowed`, `location_permission_denied`: `app/onboarding.tsx`.
- `deal_viewed`: existing home/map tracking in `app/(tabs)/index.tsx` and `components/map/map-native-screen.tsx`.
- `shop_viewed`: single business detail fetch observed in `lib/supabase.ts`.
- `favorite_added`, `favorite_removed`: favorites insert/delete observed in `lib/supabase.ts`.
- `alert_opt_in_accepted`, `alert_opt_in_declined`: exact `deal_alerts_enabled` toggle observed in `lib/supabase.ts`.
- `deal_claimed`: existing claim tracking in `app/(tabs)/index.tsx`, `app/deal/[id].tsx`, and `app/(tabs)/wallet.tsx`.
- `deal_redeemed`: `redeem-token` and `complete-visual-redeem` function success observed in `lib/supabase.ts`.
- `business_deal_created`: deals insert observed in `lib/supabase.ts`.
- `app_error`: React Native `ErrorUtils` handler in `lib/supabase.ts`.

Validation results:

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- Vitest was not run because no test wrapper was added and Task 10 did not require additional tests.
- `npx expo start` was not run; no manual UI check was required for this observability-only change.
- Provider event evidence was not captured in this pass; verify against local/deployed Supabase by exercising signup, onboarding, favorite, alert toggle, shop detail, create deal, claim, redeem, and a forced JS error, then querying `app_analytics_events`.
- Source maps were not configured because this uses the existing Supabase analytics table rather than an external crash provider with source-map upload support; release context is stored as `app_version`, `device_platform`, and `context.app_build`.

---

## Task 11 - Release Checklist Automation

Status: Complete / release smoke failed 2026-06-03; shop-detail no-live-deal defect fixed 2026-06-03.

Task: Create a repeatable beta release checklist.

Add a markdown checklist or script-backed checklist covering:

- Git clean.
- No untracked diagnostics in EAS context.
- No demo UI in production.
- Typecheck.
- Lint.
- Vitest.
- Conditional Expo start only when runtime app behavior needs a manual UI check.
- Android smoke.
- Supabase migrations.
- Supabase secrets.
- Digest cron.
- Vault secret.
- VersionCode/build URL.
- Known issues.

Acceptance:

- Every beta build has the same release report format.
- Developer can paste final SHA, build URL, versionCode, smoke result, and known issues.
- Checklist does not expose secret values.
- Checklist is understandable by Dan without engineering translation.

Verification:

- Run the checklist once against the current beta candidate.
- Include the resulting release report in the task handoff.

Findings 2026-06-03 (re-run against current candidate `ec621fb`):

1. What I found
   - Release validation steps were spread across existing deployment, migration, smoke-test, and proof-check docs, but there was no single beta release report format.
   - The checklist was re-executed against the current beta candidate `ec621fb` on branch `fix/production-clean-copy`. The repo is clean: `git status --short --untracked-files=all` and `git ls-files --others --exclude-standard` returned no changes/untracked files.
   - Production EAS environment inspection returned Android versionCode `9` (advanced from the prior recorded `8`; `production` uses `autoIncrement: true`) and did not list demo/debug public flags; `eas.json` keeps demo/debug flags in development/preview only.
   - Supabase migration list showed every local migration applied remotely with no drift, ending with `20260708150000_weekly_digest_cron`.
   - Android smoke was re-run on emulator `emulator-5554` with the current local APK `application-e0d34c3b-102e-498d-b81b-45ebd0b59ea8.apk`; `aapt` and the installed package both reported `versionCode=9`, matching EAS production Android versionCode `9`.
   - Smoke result: failed / partially completed. The follow-up run reached the signed-in business Create, Redeem, My offers, Billing, Account, customer Home, Shops, shop detail, back navigation, and Map surfaces. Wallet, Settings, and claim -> wallet -> QR/redeem were not completed in this follow-up because the customer Map tab triggered a visible Android "TWOFER isn't responding" ANR after the map loaded.
   - Release-smoke issues found: Map tab ANR blocked the current pass; no live deal / active wallet ticket was reachable for claim and redeem coverage; shop detail showed "Use this deal" / "Scan QR at counter" guidance under a no-live-deal empty state; demo-named business/deal data appears throughout the tested demo account.
   - `npx supabase secrets list` returned "Access token not provided" because this shell has no `supabase login` / `SUPABASE_ACCESS_TOKEN`; secret names were not verified remotely and no values were read.
2. Why it matters
   - Every beta build now has one consistent handoff covering git state, EAS context, validation, Android smoke, Supabase migrations/secrets, digest cron/vault, versionCode/build URL, and known issues.
   - The report avoids secret values and gives Dan readable pass/blocker language.
3. Recommended fix
   - `docs/beta-release-checklist.md` holds a reusable release report template plus the refreshed 2026-06-03 current-run report (candidate `ec621fb`, versionCode `9`).
   - The checklist records secret checks by name only and marks remote-only checks as manual or blocked when the local shell cannot verify them.
4. Files affected
   - `docs/beta-release-checklist.md`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results (re-run 2026-06-03):

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npm test` - passed, 23 files and 171 tests.
- `npx supabase migration list` - passed; every local migration had a matching remote entry (last `20260708150000_weekly_digest_cron`).
- `npx supabase secrets list` - blocked: "Access token not provided" (no Supabase CLI auth); no secret values were exposed.
- `npx eas-cli build:version:get -p android --profile production --non-interactive` - returned Android versionCode `9`.
- `npx expo start` was not run because this task changed documentation only.
- Android smoke was re-run against installed `versionCode=9` after reinstalling `application-e0d34c3b-102e-498d-b81b-45ebd0b59ea8.apk`; fresh screenshots captured successfully, but the result remains failed / partially completed because the Map tab ANR blocked Wallet, Settings, and claim/redeem coverage.

Smoke defect follow-up 2026-06-03:

1. What I found
   - Business detail always rendered wallet redemption guidance after the live-deals section, even when the filtered active/live deal list was empty.
2. Why it matters
   - No-live-deal shops appeared to instruct customers to use or scan a deal that does not exist.
3. Recommended fix
   - Gated the redemption guidance card in `app/business/[id].tsx` so it renders only when at least one live deal is present.
   - Preserved claim logic, navigation, analytics, billing, dashboard, and create-deal behavior.
4. Files affected
   - `app/business/[id].tsx`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results (smoke defect fix 2026-06-03):

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- Expo/Android smoke was not run in this pass; manual check should open a no-live-deal shop detail and confirm only the empty state appears below active deals, then open a live-deal shop detail and confirm the redemption guidance still appears under the deal card.

---

## Task 12 - Copywriting Pass

Status: Complete (lightweight validation).

Task: Rewrite rough user-facing copy across consumer and business flows.

Tone:

- Short.
- Confident.
- Local.
- Helpful.
- No startup jargon.
- No technical terms.

Examples:

- "No live deals nearby"
- "Browse metro shops"
- "Favorite shops to hear when they post a deal"
- "Show this QR code to the cashier"
- "Create a strong two-for-one offer"

Acceptance:

- Copy sounds like a polished consumer app.
- No raw technical language.
- Spanish and Korean keys stay in sync if localization files are touched.
- Copy fits on Android without clipping.
- Copy does not overpromise deal availability or business hours.

Verification:

- Typecheck: Passed (`npm run typecheck`).
- Lint: Passed (`npm run lint`).
- Locale parity: Passed custom English/Spanish/Korean key parity check.
- Technical-copy scan: Passed for obvious raw terms (`server`, `token`, `deal_id`, `claim_id`, `Supabase`, `QA`, `pilot`, etc.).
- Expo/screenshots: Not run; changes were limited to locale copy and no manual UI session was started.

Task 12 findings:

1. What I found
   Rough copy was concentrated in auth/demo messages, onboarding empty states, API error translations, wallet/QR/redeem labels, create-deal helper text, dashboard metrics, billing, and settings. Spanish and Korean also had missing keys plus leftover technical wording in the same areas.
2. Why it matters
   Customers and business owners could see internal terms like server, token, IDs, dev/QA labels, pilot billing language, or awkward claim/redeem phrasing.
3. Recommended fix
   Completed: rewrote affected locale copy to be shorter, more confident, and non-technical; added missing Spanish/Korean keys to match English.
4. Files affected
   `lib/i18n/locales/en.json`, `lib/i18n/locales/es.json`, `lib/i18n/locales/ko.json`.
5. MVP priority: High

Changed copy key groups:

- `tabs.tabMode`, `dealsBrowse`, `consumerHome`, `consumerMap`, `onboarding`, `consumerProfile`, `businessProfile`
- `apiErrors`, `auth`, `authLanding`, `account`, `settingsScreen`
- `consumerWallet`, `consumerQr`, `redeem`
- `createHub`, `menuScan`, `menuWorkflow`, `menuOffer`, `aiCompose`, `createAi`, `createDeal`
- `offersDashboard`, `merchantInsights`, `businessScan`, `businessAiSelection`, `businessTemplates`, `dealAnalytics`
- `businessSetup`, `billing`, `billingManage`, `commonUi`, `consumerDealDetail`, `report`

---

## Map tab ANR follow-up

Status: Implemented - updated-build Android smoke passed 2026-06-03.

Findings 2026-06-04:

1. What I found
   - Task 11 release smoke showed the customer Map tab loading Google map tiles and pins, then Android raised a visible `TWOFER isn't responding` ANR.
   - Focused Map inspection found the highest-risk path in `components/map/live-deal-halo.tsx`: live-deal halos used `Animated.loop` with `useNativeDriver:false` to animate `react-native-maps` `Circle` radius props. Each live marker rendered two animated map overlays, creating continuous JS-to-native map updates after the map appeared.
   - Claude Code was used via `claude -p` for investigation and confirmed this as the most likely ANR cause. A second `claude -p --permission-mode acceptEdits` pass implemented the one-file Map fix.
2. Why it matters
   - The Map ANR blocked release smoke before Wallet, Settings, and claim/redeem coverage could be completed.
   - Continuous JS-driven map overlay animation can starve Android input handling, especially on emulator and with multiple live markers.
3. Recommended fix
   - Completed: replaced pulsing `AnimatedCircle` live-deal halos with static `Circle` halos.
   - Kept `useLiveDealPulse` and `LiveDealHaloCircles` exports so `components/map/map-native-screen.tsx`, navigation, analytics, data loading, marker taps, and camera behavior were left unchanged.
4. Files affected
   - `components/map/live-deal-halo.tsx`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results:

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- Android smoke was attempted but not completed: `adb shell` commands timed out, the Android emulator MCP UI dump timed out, and after `adb kill-server` / `adb start-server`, `emulator-5554` reported `offline`; `adb wait-for-device` timed out.
- The installed versionCode `9` APK from Task 11 does not contain this source fix, so launching that APK would not validate the change. A new build or dev-client session containing this patch is required for a meaningful Map smoke.

Updated-build smoke result:

- VersionCode `10` APK `application-b6700649-9ac5-4227-8fd8-6089d3746ed7.apk` was installed on `emulator-5554` during the final RC smoke.
- Map opened with Google tiles and pins, remained responsive after a 30-second wait, and allowed All businesses / Live deals toggle interaction.
- No Android `TWOFER isn't responding` dialog appeared, and recent logcat checks did not show a `com.unvmex2.twoforone` ANR or fatal exception.
- Map no longer blocks release smoke for this APK.

---

## Final visual consistency pass

Status: Complete / validated 2026-06-04.

Findings 2026-06-04:

1. What I found
   - Home deal cards, shop row cards, wallet tickets, dashboard snapshot metrics, dashboard stat pills, and the deal-management bottom sheet were using a mix of `Radii.lg`, `Radii.md`, `999`, shallow shadows, and local button fills.
   - Wallet primary actions used green and black fills instead of the shared TWOFER orange primary button treatment.
   - Shared primary buttons, secondary buttons, branded confirm modals, and reusable empty-state cards were already centralized and visually consistent, so their behavior/files were left unchanged.
2. Why it matters
   - The beta surfaces looked close, but the mixed card corners, shadows, pills, and wallet button colors made the app feel assembled from separate passes instead of one product system.
3. Recommended fix
   - Completed: aligned home deal cards, shop cards, wallet cards, dashboard metric cards, status/stat pills, favorite controls, the local home empty card, and the dashboard modal sheet to the same 24px card radius, branded pill treatment, consistent bordered favorite affordances, and orange primary CTA treatment.
   - Preserved navigation, Supabase calls, claim/redeem logic, dashboard calculations, favorite persistence, analytics, and modal action behavior.
4. Files affected
   - `app/(tabs)/index.tsx`
   - `components/business-row-card.tsx`
   - `app/(tabs)/wallet.tsx`
   - `app/(tabs)/dashboard.tsx`
   - `TASK_QUEUE.md`
5. MVP priority: Medium

Validation results:

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npx expo start` and Android screenshots were not run; this was a visual-only static pass and no manual UI session was started.

Manual check:

- Android smoke should verify Home live deal cards, Shops row cards, Wallet active/ended tickets, Dashboard snapshot metrics, and the Dashboard Manage Deal sheet. Expected result: cards use the same rounded 24px shape and lift, pills are consistently rounded, hearts have the same bordered/favorited treatment, and wallet primary actions are orange.

---

## Final RC Smoke Test

Status: Complete / passed with data-limited claim and redeem coverage on 2026-06-03.

Findings 2026-06-03:

1. What I found
   - Newest APK in the TWOFER folder: `C:\Users\unvme\Downloads\twoforone\application-b6700649-9ac5-4227-8fd8-6089d3746ed7.apk`.
   - `aapt dump badging` reported package `com.unvmex2.twoforone`, `versionCode=10`, `versionName=1.0.0`.
   - Claude Code was used via `claude -p` for the final Android smoke. It recovered `emulator-5554`, installed the APK with `adb install -r`, launched TWOFER, navigated the app, and captured screenshots under `qa-screens/final-rc-smoke/`.
   - Installed package verification matched the APK: `versionCode=10`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 21:09:06`.
   - Screens passed: signed-out auth landing, login, consumer Home, Shops, shop detail/back navigation, Map, Map 30-second wait, Map pins/toggles, Wallet, Settings, business mode switch, merchant redeem manual Ticket code, business dashboard/My offers, Create hub, Billing, and business Account.
   - Consumer onboarding was not shown for the returning demo account.
   - Claim -> wallet -> QR/pass -> redeem could not be fully tested because the account had no active live deal or active wallet ticket. Wallet showed no active deals and only expired tickets.
   - The prior Map ANR did not reproduce on the versionCode `10` APK. Map stayed responsive after the 30-second wait and interactions, and recent logcat did not show a `com.unvmex2.twoforone` ANR or fatal exception.
   - No crashes, ANRs, raw Supabase/RLS errors, stack traces, demo helper login UI, black screens, or broken navigation were observed.
   - Known non-blocking issues: Billing shows "Free trial active" on the Twofer Pro card while "Current plan" is highlighted on Twofer Premium; business Account shows demo profile values `Met` / `E` under "Your Coffee Shop", likely demo seed/profile data.
2. Why it matters
   - This validates that the fresh release-candidate APK includes the Map ANR fix and can complete the main consumer and merchant navigation smoke that versionCode `9` could not complete.
   - The remaining money-flow gap is data setup, not a crash found in this APK.
3. Recommended fix
   - No app code changes were made during final smoke.
   - Before inviting external testers, seed or create one active live deal and active ticket to complete claim -> wallet -> QR/pass -> merchant redeem proof.
   - Review the Billing plan state and demo Account profile data in a follow-up polish task if this demo account will be shown to non-engineering testers.
4. Files affected
   - `TASK_QUEUE.md`
   - `docs/beta-release-checklist.md`
   - Screenshots captured under ignored local folder `qa-screens/final-rc-smoke/` and should not be committed.
5. MVP priority: High

Validation results:

- `claude -p` final smoke run - completed, with two focused follow-up runs for signed-out auth/login/Billing and merchant manual redeem/business Account screenshots.
- `aapt dump badging application-b6700649-9ac5-4227-8fd8-6089d3746ed7.apk` - package `com.unvmex2.twoforone`, `versionCode=10`, `versionName=1.0.0`.
- `adb -s emulator-5554 shell dumpsys package com.unvmex2.twoforone` - installed `versionCode=10`, `versionName=1.0.0`.
- Recent logcat scan - no `com.unvmex2.twoforone` ANR or fatal exception found.
- Typecheck/lint were not run because this task modified release docs only and did not change app code.

Screenshots captured:

- `signed_out_auth_landing.png`
- `completed_login.png`
- `04_home_deals.png`
- `05_shops_tab.png`
- `06_shop_detail.png`
- `07_map_tab.png`
- `07b_map_30s.png`
- `07c_map_pin_tap.png`
- `07d_map_livedeals.png`
- `08_wallet.png`
- `09_merchant_redeem.png`
- `redeem_ticket_code.png`
- `10_business_mode_switch.png`
- `11_business_dashboard.png`
- `13_create_deal_hub.png`
- `billing_tab.png`
- `12_settings.png`
- `12b_settings_scrolled.png`
- `12c_settings_scrolled2.png`
- `business_account_tab.png`

---

## Final Money-Flow Validation

Status: Complete / passed on versionCode `10` APK after `redeem-token` backend deploy.

Findings 2026-06-03 local device run:

1. What I found
   - Claude Code was used via `claude -p` for scoped data/setup reconnaissance. It identified `npm run seed:demo` as the preferred reset path when service-role env is available.
   - The local `.env` for this run had the APK-facing public Supabase URL/anon key and demo credentials, but did not have `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, so `npm run seed:demo` was not usable without adding secrets.
   - Using the existing demo account through the normal Supabase anon client/RLS path, the current demo business had no active owned deals and no active unredeemed claims.
   - Minimum data setup used: inserted one strong live deal under `Demo Roasted Bean Coffee`: `2-for-1 Latte Pair`, price `$6.50`, max claims `25`, active now through `2026-06-11T02:54:02.823Z`, with BOGO/free-item copy that passes the strong-deal guardrail. The remote schema cache did not expose optional `deals.location_id`, so the row was inserted without that field.
   - Installed APK verification via `adb -s emulator-5554 shell dumpsys package com.unvmex2.twoforone` returned `versionCode=10`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 21:09:06`. `aapt` was not available on PATH in this shell.
   - Consumer Home displayed the seeded live deal; Claim Deal succeeded; the app immediately displayed the active QR and claim code `BH2 4NS`.
   - After relaunch, Home showed the deal as `Claimed`, Wallet showed the active ticket with code `BH2 4NS`, and Business dashboard showed `Claims: 1`.
   - Wallet `Use deal` and `Show QR & code` controls appeared enabled but did not respond to MCP or raw `adb shell input tap` in this run after Wallet was opened. The QR/pass evidence captured is the QR modal that opened immediately after claim plus the active Wallet ticket.
   - Merchant Redeem manual Ticket code flow accepted `BH24NS`, reached the deployed `redeem-token` function, then failed with visible raw copy: `Edge Function returned a non-2xx status code`.
   - A direct signed-in Supabase function invocation with the same short code showed the underlying 500 response body: `Failed to redeem token: new row for relation "deal_claims" violates check constraint "deal_claims_redeem_method_check"`.
   - The claim remains active and unredeemed after the failed manual redeem attempt.
2. Why it matters
   - The data gap from the final RC smoke is resolved: current versionCode `10` can show a live claimable deal, create a claim, persist it into Wallet, and reflect the claim on the merchant dashboard.
   - The money flow is still not beta-ready because merchant manual redemption cannot complete against the deployed backend/database combination, and the APK surfaces a raw edge-function error instead of friendly staff guidance.
3. Recommended fix
   - Align the deployed `redeem-token` function and database `deal_claims_redeem_method_check` constraint. The current function writes `redeem_method = "short_code"` for manual code redemption, while the database constraint rejects that value.
   - After fixing/deploying the backend, rerun this exact versionCode `10` APK money-flow smoke with one fresh active claim and verify Wallet QR/pass buttons, manual Ticket code redeem, post-redeem Wallet state, and dashboard redemptions.
4. Files affected
   - `TASK_QUEUE.md`
   - `docs/beta-release-checklist.md`
   - Screenshots captured under ignored local folder `qa-screens/final-money-flow/` and should not be committed.
5. MVP priority: High

Validation results:

- `claude -p` scoped reconnaissance - completed.
- Data setup - completed through Supabase anon/RLS using the existing demo account; no service-role key was used or printed.
- APK version - installed package reports `versionCode=10`, `versionName=1.0.0`.
- Claim -> Wallet -> QR evidence - passed through claim success QR and active Wallet ticket.
- Merchant manual redeem - failed / blocked by deployed backend/database mismatch.
- Typecheck/lint were not run because no app code was changed; this pass changed release documentation only after device validation.

Screenshots captured in `qa-screens/final-money-flow/`:

- `00_initial_state_step.png`
- `01_home_live_deal_seeded_step.png`
- `02_claim_cta_visible_step.png`
- `03_after_claim_blank_or_transition_step.png`
- `04_after_hide_qr_state_step.png`
- `05_hide_retry_state_step.png`
- `06_back_after_qr_state_step.png`
- `07_after_adb_hide_visible_step.png`
- `08_wallet_active_ticket_step.png`
- `09_business_dashboard_claim_count_step.png`
- `10_merchant_ticket_code_entry_step.png`
- `11_merchant_redeem_failed_raw_error_step.png`

Fix follow-up 2026-06-04:

1. What I found
   - `supabase/functions/redeem-token/index.ts` selected claims by either full QR token or normalized `short_code`, but wrote `redeem_method = "short_code"` for manual staff entry.
   - The live constraint `deal_claims_redeem_method_check` from `20260327120000_launch_visual_redeem_analytics.sql` allows only `NULL`, `visual`, and `qr`; Wallet display and visual redeem code also treat stored methods as `visual` or `qr`.
   - The manual short code is a fallback input path for the same staff QR redemption channel, not a separate stored redeem method.
   - `lib/functions.ts` did not read non-2xx Edge Function response bodies for `redeem-token`, so Supabase's wrapper message could reach `app/(tabs)/redeem.tsx` as raw copy.
2. Why it matters
   - Manual merchant redeem failed after all ownership, expiration, and race checks passed because the final update violated the database constraint.
   - Staff could see raw infrastructure copy instead of a clear redeem failure message when the Edge Function returned a non-2xx response.
3. Recommended fix
   - Completed: manual short-code redeem now stores `redeem_method = "qr"` and analytics uses the same stored method. Existing visual/pass redemption remains `visual`.
   - Completed: `redeemToken` now reads the Edge JSON error body when available and normalizes generic non-2xx or failed-update redeem errors to the existing friendly ticket failure message.
   - No migration was added; changing the function value is the correct fix because the existing constraint matches the app's two stored redeem method states.
4. Files affected
   - `supabase/functions/redeem-token/index.ts`
   - `lib/functions.ts`
   - `lib/i18n/api-messages.test.ts`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results:

- `npx vitest run lib/i18n/api-messages.test.ts supabase/functions/_shared/claim-redeem.test.ts` - passed, 16 tests.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npm run typecheck:functions` - blocked because `deno` is not installed on PATH in this shell.

Historical deploy notes:

- `redeem-token` needed to be deployed before retesting merchant manual redeem against Supabase; the 2026-06-04 retest below confirms the deployed function now passes.
- No database migration is required for this fix.
- A new APK or app update is required to validate the improved friendly client-side redeem failure copy. Backend-only deploy should be enough to make the existing versionCode `10` APK complete manual redeem successfully, but it will not contain the client fallback-copy fix.

Retest result 2026-06-04:

1. What I found
   - Claude Code was used via `claude -p` for scoped retest confirmation. The Android validation was run against the already-installed APK on `emulator-5554`; no reinstall was needed.
   - Installed package verification returned `versionCode=10`, `versionName=1.0.0`, `lastUpdateTime=2026-06-03 21:09:06`.
   - Backend function tested: deployed `redeem-token`.
   - Data setup used the normal Supabase anon/RLS path with the existing demo account. One stale unredeemed demo claim from the prior failed run was marked `canceled`, then a fresh live deal was inserted under `Demo Roasted Bean Coffee`: `BOGO: 2-for-1 Cold Brew Pair 20260604034035`, price `$5.75`, max claims `25`, active through `2026-06-11T03:40:35.739Z`.
   - The fresh deal detail opened in the installed APK via deep link and showed `Claims remaining: 25 / 25`. Tapping `Claim` created a fresh active backend claim with code `8RT XUC`, but the deal-detail screen stayed visually stuck on `Claiming...` until app relaunch.
   - After relaunch, Wallet showed the fresh active ticket, visible QR area, and code `8RT XUC`. The dedicated `Show QR & code` backup button still did not open a modal via MCP or raw `adb shell input tap`; the Wallet card itself displayed the QR/code evidence.
   - Business dashboard before redeem showed the fresh deal with `Claims 1`, `Redeemed 0`.
   - Merchant Redeem manual Ticket code accepted `8RTXUC`, reached deployed `redeem-token`, and passed. The app showed the branded `Redeemed` success receipt for the fresh deal.
   - Backend verification showed the fresh claim `claim_status = redeemed`, `redeem_method = qr`, and a non-null `redeemed_at`.
   - Consumer Wallet after redeem showed no active deals, `Deals redeemed: 1`, `$5.75` estimated savings, and the fresh ticket under Ended deals as `Redeemed by staff scan`.
   - Business dashboard after a fresh load showed global `Redemptions: 1`; the fresh deal row showed `Claims 1`, `Redeemed 1`, `Redeem rate 100%`.
2. Why it matters
   - The backend/manual redemption blocker from the previous money-flow run is resolved for the deployed backend against the existing versionCode `10` APK.
   - The final money-flow proof now covers claim -> wallet -> QR/code -> merchant manual redeem -> wallet redeemed state -> business dashboard redemption count.
3. Recommended fix
   - No app code changes were made in this retest.
   - Follow up separately on the deal-detail post-claim loading state and Wallet `Show QR & code` button hit/open behavior; neither blocked manual redeem because Wallet rendered the active ticket code and QR area.
4. Files affected
   - `TASK_QUEUE.md`
   - `docs/beta-release-checklist.md`
   - Screenshots captured under ignored local folder `qa-screens/final-money-flow-retest/` and should not be committed.
5. MVP priority: High

Validation results (retest 2026-06-04):

- APK version - installed package reports `versionCode=10`, `versionName=1.0.0`.
- Backend function tested - deployed `redeem-token`.
- Claim -> Wallet -> QR/code - passed, with active Wallet ticket and code `8RT XUC`.
- Merchant manual redeem - passed in the APK and stored `redeem_method = qr`.
- Wallet redeemed state - passed.
- Business dashboard redemption count - passed after fresh dashboard load.
- Typecheck/lint were not run because no app code was changed; this pass updated release documentation only after device validation.

Screenshots captured in `qa-screens/final-money-flow-retest/`:

- `00_stale_previous_redeem_error.png`
- `01_relaunch_consumer_home.png`
- `02_fresh_deal_detail_claim_cta.png`
- `03_fresh_deal_claim_cta_visible.png`
- `04_after_claim_detail_still_claiming.png`
- `05_claim_still_waiting_or_result.png`
- `06_relaunch_after_claim.png`
- `07_wallet_active_ticket_qr_code.png`
- `08_wallet_active_ticket_buttons.png`
- `09_show_qr_code_tap_result.png`
- `10_business_mode_relaunch.png`
- `11_settings_switch_to_business_visible.png`
- `12_business_dashboard_pre_redeem_claim_count.png`
- `13_merchant_ticket_code_entered.png`
- `14_merchant_redeem_success.png`
- `15_wallet_redeemed_state.png`
- `16_business_dashboard_after_redeem_relaunch.png`
- `17_business_dashboard_after_redeem_count.png`

Release blocker follow-up 2026-06-04:

1. What I found
   - `claude -p` was attempted for the requested investigation/implementation, but Claude Code is not authenticated in this shell and returned `Not logged in - Please run /login`; the fix was completed locally with Codex after that blocker.
   - Deal detail only opened the QR modal from the direct `claim-deal` response. If the backend created the claim but the client response timed out or failed to finish cleanly, the screen could remain in the claim path until relaunch even though Wallet/dashboard had the persisted claim.
   - Wallet's active ticket already had the token and short code, but the dedicated `Show QR & code` action was a small text-only press target. The displayed QR/code evidence panel itself was not tappable.
2. Why it matters
   - A real shopper can think a claim failed or is still processing after TWOFER already created a live ticket.
   - A backup QR/code action needs to be easy to open during a business-owner demo, especially if staff asks for the QR modal rather than reading the card code.
3. Recommended fix
   - Completed: deal detail now races the whole claim operation against the existing 15-second UX timeout, then checks for a newly-created active claim for the same user/deal and opens the QR modal if the backend already persisted it.
   - Completed: deal detail refresh and claim recovery share the same active-claim lookup and QR-opening helper; successful claim count refresh remains best-effort and claim creation logic is unchanged.
   - Completed: Wallet now lets the visible scan/code panel open the same QR/code modal, and the `Show QR & code` backup action is a larger bordered 50px target with hit slop.
   - Left alone: demo data cleanup, billing, Supabase schema, edge functions, merchant redeem, dashboard counts, onboarding, and navigation.
4. Files affected
   - `app/deal/[id].tsx`
   - `app/(tabs)/wallet.tsx`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results:

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npx vitest run lib/claim-redeem-deadline.test.ts` - passed, 5 tests.
- Focused claim/wallet interaction tests were not found in the current test suite.
- Expo/Android smoke was not run in this pass.

APK requirement:

- A new APK is required. These are runtime app code changes in deal detail and Wallet, so the already-installed versionCode `10` APK will not include the fixes.

---

## Merchant Demo / Business Data Cleanup

Status: Complete - hosted owner-demo data verified clean after admin stale-row removal 2026-06-04.

Findings 2026-06-04:

1. What I found
   - `claude -p` is installed and authenticated in this shell. A narrow reconnaissance prompt was attempted, but it timed out after 124 seconds without returning findings, so Codex completed the scoped inspection and implementation directly.
   - `Met` / `E` are not hardcoded Account UI strings. A read-only anon/RLS probe of the existing hosted demo account showed they currently live in `business_profiles.name = Met` and `business_profiles.address = E`.
   - The same hosted demo account still has `businesses` values from the old seed: `Demo Roasted Bean Coffee`, `Demo Owner`, `hello@demo.twofer.app`, Dallas address/hours, and preview-tester description copy.
   - The old demo business/deal values came from `scripts/seed-demo.cjs`, `lib/demo-preview-seed.ts`, and `supabase/seed_demo_coffee_business.sql`. The timestamped smoke-test deal names came from prior manual validation data, so the updated seeds now remove those legacy titles/prefixes before inserting the polished demo deal set.
   - `app/(tabs)/account.tsx` displays the business profile snapshot returned from `business_profiles`; no Account display bug was found in this scoped pass.
2. Why it matters
   - A real cafe or restaurant owner seeing `Met`, `E`, `Demo Roasted Bean Coffee`, or timestamped test deal names would immediately read the product as unfinished.
   - Cleaning both `businesses` and `business_profiles` is required because the Account summary uses the profile table while other merchant/marketplace surfaces use the business row.
3. Recommended fix
   - Completed: replaced the canonical demo business with `Cedar & Bean Cafe`, `Maya Patel`, `hello@cedarbean.cafe`, Grapevine address/location, clean ASCII hours, and polished cafe description/category values.
   - Completed: replaced visible demo deal titles with merchant-ready BOGO titles: `Buy One Latte, Get One Free`, `2-for-1 Pastry Pair Before Noon`, `BOGO Iced Tea Launch Special`, `Weekday Cold Brew 2-for-1`, and `Saturday Bakery Box BOGO`.
   - Completed: updated the demo-login helper to treat old demo names/contact email as legacy data, refresh the `business_profiles` display fields, and delete known old/smoke-test deal titles before inserting the polished set.
   - Existing hosted remote demo data still needs to be refreshed manually because this shell does not have `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` for `npm run seed:demo`. Run the updated `npm run seed:demo` with service-role env, or sign into the demo account from a new build containing the updated `ensureDemoCoffeePreview` helper.
4. Files affected
   - `scripts/seed-demo.cjs`
   - `lib/demo-preview-seed.ts`
   - `supabase/seed_demo_coffee_business.sql`
   - `docs/DEMO_SEED.md`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results:

- `node -c scripts/seed-demo.cjs` - passed.
- Focused static seed scan - passed; required polished values exist in Node, TS helper, and SQL seed, and old non-legacy display strings are absent.
- Hosted demo read-only probe through normal anon/RLS - confirmed current remote data still has old `businesses` values and `business_profiles` values `Met` / `E`; no secrets were printed.
- Service-role seed execution - not available in this shell because `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are not both present.
- `npm run typecheck` - passed.
- `npm run lint` - passed.
- Expo/Android smoke was not run; this was demo seed/helper data cleanup and no manual UI session was started.

Manual check:

- After refreshing hosted demo data, open Business mode -> Account. Expected result: the business card and editable profile show `Cedar & Bean Cafe`, `120 S Main St`, `Cafe & Bakery`, `Maya Patel`, `hello@cedarbean.cafe`, Grapevine location, clean hours, and no `Met` / `E` values.
- Home/Shops/Dashboard demo deal surfaces should show polished BOGO deal titles without `Demo`, `(live)`, `(scheduled)`, timestamp suffixes, or preview-tester copy.

Hosted refresh follow-up 2026-06-04:

1. What I found
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_ANON_KEY` were not present in the shell environment; no secret values were printed.
   - The local `.env` public Expo Supabase values were available for a normal anon/RLS demo sign-in path; no service-role key was used.
   - Read-only anon/RLS probe confirmed the demo account owned the stale `Demo Roasted Bean Coffee` business, the `business_profiles` row with `Met` / `E`, and old/timestamped deal rows.
   - A separate public stale business row still exists as `My Coffee`, address/location `124`, contact `Demo Owner`, `hello@demo.twofer.app`, id prefix `a0000000`; it is not owned by the demo account under RLS.
2. Why it matters
   - The main demo-owned business/profile/deal surfaces now show polished Cedar & Bean data, but consumer discovery can still expose the unowned stale `My Coffee` / `124` public business until an admin/service-role cleanup removes it.
3. Recommended fix
   - Completed via normal anon/RLS: updated the hosted demo-owned business to `Cedar & Bean Cafe`, `Maya Patel`, `hello@cedarbean.cafe`, `120 S Main St`, `Grapevine, TX`, polished hours, category, and description.
   - Completed via normal anon/RLS: updated the hosted demo `business_profiles` display row to `Cedar & Bean Cafe`, `120 S Main St`, `Cafe & Bakery`, preserving existing `active` / `premium` billing state.
   - Completed via normal anon/RLS: replaced the demo-owned stale/timestamped deal rows with `Buy One Latte, Get One Free`, `2-for-1 Pastry Pair Before Noon`, `BOGO Iced Tea Launch Special`, `Weekday Cold Brew 2-for-1`, and `Saturday Bakery Box BOGO`.
   - Blocked by RLS: anon delete of the exact stale `My Coffee` / `124` row returned zero deletable rows because it is not demo-owned. Run this admin SQL in Supabase SQL Editor, then rerun `npm run seed:demo` with service-role env if you want a service-role refresh:

```sql
DELETE FROM public.businesses
WHERE id = 'a0000000-0000-4000-8000-00000000c0de'
  AND name = 'My Coffee'
  AND address = '124'
  AND business_email = 'hello@demo.twofer.app';
```

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service-role-key>"
npm run seed:demo
```

4. Files affected
   - `TASK_QUEUE.md`
   - `docs/beta-release-checklist.md`
5. MVP priority: High

Validation results:

- Anon/RLS hosted refresh command - passed; no service-role key was used.
- Read-only anon/RLS verification - passed for demo-owned data: Cedar & Bean Cafe business/profile values are present, Maya Patel and `hello@cedarbean.cafe` are present, Grapevine location is present, and demo-owned stale strings/deal titles are absent.
- Final public stale scan - still finds only the unowned `My Coffee` / `124` row; stale deal title scan returns no old/timestamped deal titles.
- `npm run seed:demo` - not run because `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are missing from the shell.
- Typecheck/lint were not run because no app/source code changed; this pass refreshed hosted data and updated release docs only.

Hosted admin cleanup verification 2026-06-04:

1. What I found
   - `claude -p` was available and was attempted for this narrow verification, but it timed out after 184 seconds without returning findings; Codex completed the read-only verification directly.
   - Verification used only public anon/RLS reads plus the normal demo account anon session. No service-role key was used and no secret values were printed.
   - Unauthenticated public Shops-visible `businesses` scan found zero stale matches across 2 visible rows.
   - Authenticated public Shops-visible `businesses` scan found zero stale matches across 2 visible rows.
   - Authenticated Home-visible/public `deals` scan found zero stale matches across 5 visible rows.
   - Demo-owned business data now shows `Cedar & Bean Cafe`, `Maya Patel`, `hello@cedarbean.cafe`, `120 S Main St`, and `Grapevine`.
   - Demo-owned `business_profiles` data now shows `Cedar & Bean Cafe`, `120 S Main St`, and `Cafe & Bakery`.
   - Demo-owned deals now show the professional title set: `Buy One Latte, Get One Free`, `2-for-1 Pastry Pair Before Noon`, `BOGO Iced Tea Launch Special`, `Weekday Cold Brew 2-for-1`, and `Saturday Bakery Box BOGO`.
2. Why it matters
   - The admin SQL cleanup removed the unowned stale public `My Coffee` / `124` row that previously blocked owner-demo readiness from a data standpoint.
   - Public Shops/Home data no longer exposes `My Coffee`, address `124`, `Demo Roasted Bean Coffee`, `Met`, `E`, timestamped smoke-test deal names, or preview-tester copy.
3. Recommended fix
   - No further hosted demo data cleanup is required from the read-only verification result.
   - Continue tracking the remaining versionCode `11` runtime/UI blockers separately: Wallet QR/code modal controls, claim QR dismiss/back behavior, in-session dashboard redemption refresh, clipped claim CTA, clipped Settings mode switch, and Android Back from shop detail.
4. Files affected
   - `TASK_QUEUE.md`
   - `docs/beta-release-checklist.md`
5. MVP priority: High

Validation results:

- Read-only hosted demo data verification - passed.
- Owner-demo clean from hosted data alone: Yes.
- Typecheck/lint were not run because no app/source code changed; this pass updated release documentation only.

---

## Billing Plan State Cleanup

Status: Complete - source cleanup validated 2026-06-04.

Findings 2026-06-04:

1. What I found
   - `claude -p` was available and used for a scoped billing-state reconnaissance prompt.
   - The canonical demo seed data in `scripts/seed-demo.cjs` and `supabase/seed_demo_coffee_business.sql` sets the demo business to `subscription_status = trial` and `subscription_tier = pro`; `lib/demo-preview-seed.ts` only backfills missing billing defaults and does not overwrite an existing hosted active/premium state.
   - The confusing final-smoke state is a Billing UI labeling issue for a valid `active` + `premium` account. The Pro card did not qualify as the active Pro plan, then fell through to the pilot billing gate and showed `Free trial active`, while the Premium card correctly showed `Current plan`.
   - No payment provider logic, Stripe checkout/portal logic, billing access gate, auth, onboarding, wallet, claim/redeem, analytics, dashboard, deal creation, or navigation behavior needed to change.
2. Why it matters
   - A real business owner seeing `Free trial active` on Pro and `Current plan` on Premium can read Billing as contradictory, especially during a merchant demo.
3. Recommended fix
   - Completed: Premium-tier accounts now see a neutral `Included in Premium` state on the Pro card instead of the pilot trial banner.
   - Completed: English, Spanish, and Korean Billing locale keys were kept in sync.
   - Left alone: demo seed defaults, hosted demo data, pricing helpers, subscription access gating, and payment provider functions.
4. Files affected
   - `app/(tabs)/billing.tsx`
   - `lib/i18n/locales/en.json`
   - `lib/i18n/locales/es.json`
   - `lib/i18n/locales/ko.json`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results:

- Locale JSON parse check - passed for `en`, `es`, and `ko`.
- `npx vitest run lib/billing/access.test.ts` - passed, 10 tests.
- `npm run typecheck` - passed.
- `npm run lint` - passed.

APK requirement:

- A new APK is required to see the Billing UI copy fix because this changes runtime app code and localized strings. No backend deploy or payment-provider change is required.

Manual check:

- Open Business mode -> Billing with an active Premium account. Expected result: the Pro card says `Included in Premium` and the Premium card is the only card showing `Current plan`; there should be no `Free trial active` message next to a current Premium plan.
- Open Business mode -> Billing with a trial Pro account. Expected result: the Pro card still shows the pilot/free-trial access message, and Premium remains hidden during the single-location pilot unless the account is already Premium.

---

## Final Owner-Demo Smoke - versionCode 11

Status: Failed - not owner-demo ready 2026-06-04.

Findings 2026-06-04:

1. What I found
   - `claude -p` was available and used for scoped reconnaissance before Codex completed the APK/device smoke directly.
   - Newest APK found in the TWOFER folder: `C:\Users\unvme\Downloads\twoforone\application-11538fb6-92fc-469f-8fe9-5d41e82433e0.apk`.
   - APK metadata from `aapt dump badging`: package `com.unvmex2.twoforone`, `versionCode=11`, `versionName=1.0.0`.
   - Installed on Android emulator `emulator-5554` with `adb install -r`; installed package matched the APK with `versionCode=11`, `versionName=1.0.0`, `lastUpdateTime=2026-06-04 15:56:02`.
   - Screenshots were captured under ignored local folder `qa-screens/final-owner-demo-smoke/`.
   - Recent runtime fixes included in this APK: deal detail claim succeeded and opened the QR/code modal instead of staying stuck on `Claiming...`; Billing Pro card says `Included in Premium`; Premium is the only Billing card that says `Current plan`.
   - Recent runtime fixes still failing in this APK: Wallet QR/code panel did not open the QR/code modal, and Wallet `Show QR & code` did not open the QR/code modal.
   - Business-owner path covered: signed-out auth landing, login, business mode, business dashboard, create deal hub, Billing, Account/Settings, and merchant manual Ticket code screen.
   - Consumer proof path covered: Home deals, Shops, shop detail, fresh live deal claim, claim QR/code modal, Wallet active ticket, Wallet QR/code controls, merchant manual redeem, Wallet redeemed state, and business dashboard redemption count.
   - Map passed the 30-second responsiveness check on `emulator-5554`; no ANR, app fatal exception, or `Application Not Responding` logcat match was observed during the wait.
   - Merchant-facing demo data is not clean. Visible first-impression failures include `Demo Roasted Bean Coffee`, `Met`, `E`, `My Coffee`, address `124`, old preview-tester copy, timestamped deal names, and no `Cedar & Bean Cafe` where expected.
2. Why it matters
   - Real cafe or restaurant owners would see stale demo names and profile values that make the product feel unfinished.
   - The claim success modal now proves the new deal-detail fix is present, but the Wallet QR/code modal controls are still a direct demo blocker.
   - The QR modal `Hide` control and Android Back did not dismiss reliably after claim, which can trap the owner/demo operator in a poor state.
   - Dashboard redemption counts eventually refresh after app relaunch, but the in-session business dashboard stayed stale immediately after merchant manual redeem.
3. Recommended fix
   - Refresh hosted demo data before the next APK smoke so business and consumer surfaces show `Cedar & Bean Cafe` or another polished merchant-demo account, clean profile fields, clean addresses, and customer-facing deal titles.
   - Fix and manually verify the Wallet QR/code panel and `Show QR & code` button with real Android taps.
   - Fix the claim QR/code modal dismiss path for `Hide` and Android Back.
   - Refresh business dashboard stats after a successful redeem or when returning to the dashboard.
   - Address first-impression UI issues found in smoke: clipped claim CTA near the bottom tab bar, clipped Settings mode-switch button, and Android Back not returning from shop detail.
   - Rerun this owner-demo smoke against versionCode `11` or newer after the hosted demo data and Wallet/modal fixes are complete.
4. Files affected
   - `TASK_QUEUE.md`
   - `docs/beta-release-checklist.md`
   - Screenshots captured under ignored local folder `qa-screens/final-owner-demo-smoke/` and should not be committed.
5. MVP priority: High

Validation results:

- `aapt dump badging` confirmed the APK package and version: `com.unvmex2.twoforone`, `versionCode=11`, `versionName=1.0.0`.
- `adb -s emulator-5554 install -r` passed.
- `adb shell dumpsys package com.unvmex2.twoforone` confirmed the installed app matched `versionCode=11`, `versionName=1.0.0`.
- Screens passed: signed-out auth landing, normal login, business create hub, Billing Premium copy, merchant manual Ticket code screen, fresh claim success QR modal, Map 30-second no-ANR check, merchant manual redeem success, Wallet redeemed state, and business dashboard redemption count after app relaunch.
- Screens failed or blocked: hosted demo data cleanliness, Wallet QR/code panel modal open, Wallet `Show QR & code` modal open, claim QR/code modal dismiss/back behavior, in-session dashboard redemption count refresh, clipped claim CTA, clipped Settings mode switch, and Android Back from shop detail.
- Typecheck/lint were not run because no app code was changed; this pass updated release documentation only after APK smoke testing.
- Owner-demo ready: No.

Screenshots captured in `qa-screens/final-owner-demo-smoke/`:

- `01_signed_out_auth_landing.png`
- `02_business_create_hub_after_login.png`
- `03_business_dashboard_tour.png`
- `04_business_dashboard_stale_demo_data_FAIL.png`
- `05_billing_premium_copy_PASS.png`
- `06_account_stale_met_e_FAIL.png`
- `07_merchant_manual_ticket_code.png`
- `08_consumer_onboarding.png`
- `09_consumer_onboarding_stale_shops_FAIL.png`
- `10_home_no_live_stale_favorite_FAIL.png`
- `11_home_all_deals_stale_claimed_FAIL.png`
- `12_live_deal_timestamp_claim_button_partially_clipped_FAIL.png`
- `13_claim_success_qr_modal_PASS.png`
- `14_claim_qr_hide_back_nonresponsive_FAIL.png`
- `15_wallet_active_ticket_stale_data.png`
- `16_wallet_qr_panel_tap_no_modal_FAIL.png`
- `17_wallet_show_qr_button_no_modal_FAIL.png`
- `18_shops_list_stale_junk_FAIL.png`
- `19_shop_detail_stale_preview_copy_FAIL.png`
- `20_map_initial.png`
- `21_map_after_30s.png`
- `22_map_live_filter_after_30s.png`
- `23_merchant_manual_redeem_success.png`
- `24_dashboard_after_redeem_stale_count_FAIL.png`
- `25_dashboard_after_relaunch_redemptions_updated.png`
- `26_wallet_redeemed_state_stale_data.png`

QR/modal blocker follow-up 2026-06-04:

1. What I found
   - `claude -p` is installed, but the scoped QR/modal prompt timed out after 184 seconds; Codex completed the fix directly.
   - The shared `QrModal` used by deal detail and Home did not wire `onRequestClose`, so Android Back had no reliable modal-close path.
   - Wallet was using a separate `WalletRedeemModal` path for the QR/code backup, even though the deal-detail shared `QrModal` was the modal proven to open during the versionCode `11` smoke.
   - The Wallet QR/code panel and `Show QR & code` button used the animated haptic pressable wrapper in the failing path; the controls now use native press targets while preserving the same active-ticket guards.
2. Why it matters
   - The owner-demo operator must be able to close the QR/code modal with either Hide or Android Back.
   - Wallet needs the same reliable QR/code modal path as deal detail so staff can scan the ticket or read the short code during a live demo.
3. Recommended fix
   - Completed: shared `QrModal` now handles Android Back with `onRequestClose={onHide}`.
   - Completed: Wallet now renders the shared `QrModal` persistently and drives it from the QR/code panel and `Show QR & code` button.
   - Completed: Wallet passes the raw claim expiry plus grace minutes into `QrModal`, avoiding double-added grace time while preserving existing claim and redeem deadlines.
   - Left alone: hosted data, billing, analytics, dashboard counts, Supabase schema, edge functions, merchant redeem, onboarding, auth, and navigation structure.
4. Files affected
   - `components/qr-modal.tsx`
   - `app/(tabs)/wallet.tsx`
   - `TASK_QUEUE.md`
5. MVP priority: High

Validation results:

- `npm run typecheck` - passed.
- `npm run lint` - passed.
- `npx vitest run lib/claim-redeem-deadline.test.ts supabase/functions/_shared/claim-redeem.test.ts supabase/functions/_shared/claim-limits.test.ts` - passed, 13 tests.
- Focused Wallet/modal interaction tests were not found in the current test suite.
- Expo/Android smoke was not run in this pass; the next owner-demo APK smoke should verify claim QR Hide, Android Back from the QR modal, Wallet QR/code panel open, and Wallet `Show QR & code` open with real Android taps.

APK requirement:

- A new APK is required. These are runtime app code changes in the shared QR modal and Wallet QR/code controls, so the installed versionCode `11` APK will not include the fixes.

---

## Recommended Order

1. Task 1 - Production UI Cleanup.
2. Task 2 - App-Wide Branded Confirmations.
3. Task 3 - Loading, Empty, And Error States.
4. Task 4 - Auth And Onboarding Polish.
5. Task 5 - Deal And Shop Card Polish.
6. Task 6 - Shop Detail Screen.
7. Task 7 - Claim And Redeem Flow Polish.
8. Task 8 - Business Create Deal Polish.
9. Task 9 - Business Dashboard Polish.
10. Task 10 - Analytics And Crash Monitoring.
11. Task 11 - Release Checklist Automation.
12. Task 12 - Copywriting Pass.

Do not start with animation-only polish. TWOFER will feel more expensive when the core flows are consistent, trustworthy, observable, and hard to break.
