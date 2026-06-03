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

Status: Active / in progress.

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

---

## Task 4 - Auth And Onboarding Polish

Status: Queued.

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

Status: Queued.

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

---

## Task 6 - Shop Detail Screen

Status: Queued.

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

- Run typecheck.
- Run lint.
- Run vitest if navigation/data tests are added.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Android smoke from Shops list to detail and back.
- Screenshots:
  - shop with deal
  - shop without deal
  - favorited state
  - missing logo/photo fallback

---

## Task 7 - Claim And Redeem Flow Polish

Status: Queued.

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

---

## Task 8 - Business Create Deal Polish

Status: Queued.

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

---

## Task 9 - Business Dashboard Polish

Status: Queued.

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

---

## Task 10 - Analytics And Crash Monitoring

Status: Queued.

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

---

## Task 11 - Release Checklist Automation

Status: Queued.

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

---

## Task 12 - Copywriting Pass

Status: Queued.

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

- Run typecheck.
- Run lint.
- Run i18n/key-parity tests if available.
- Run `npx expo start` only if runtime behavior changed and a manual UI check is needed.
- Screenshots of changed screens.
- List changed copy keys/files.

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
