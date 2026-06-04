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

Status: Implemented - static validation passed; updated-build Android smoke still blocked.

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

Remaining blockers:

- Rebuild/install a build that includes this patch, or run an updated dev-client session, then smoke test: open Map, interact with pins/toggles, navigate to Wallet, then navigate to Settings.
- Map no longer has the identified JS animation ANR source in code, but updated-build Android smoke is still required before saying Map no longer blocks release smoke.

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
