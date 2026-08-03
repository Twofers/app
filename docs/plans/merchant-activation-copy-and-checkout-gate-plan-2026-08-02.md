# Merchant activation copy + Checkout gating plan — 2026-08-02

Status: IN PROGRESS — both decisions signed off by Dan 2026-08-02.
This file is the tracker; update checkboxes here as work lands.

**Decisions (Dan, 2026-08-02):**
1. The `ios_trial_checkout` server flip is **imminent**. So capability-dark is
   ending; the 1.0.2 iOS dead-button window is short, and the client env flag
   has no remaining purpose.
2. **Yes — Android gets the same self-serve Checkout button.**

**Design corrections found during implementation (supersede the phases below):**
- **The capability must live in the SQL RPC, not an Edge Function.** The app
  fetches capabilities by calling `get_business_capabilities` directly
  (`hooks/use-business-capabilities.ts:62`), NOT via
  `get-business-onboarding-context`. Adding the key to the Edge Function's
  `access_state` would never reach the card. Phase 2 is therefore a
  **migration**, Dan-gated for prod apply — not a deploy-anytime change.
- **The feature-flag key stays `ios_trial_checkout`.** Renaming it while a flip
  is imminent risks Dan enabling one row while the deployed function reads
  another, and any `ON CONFLICT DO UPDATE` migration touching that row risks the
  known `enabled = false` reset trap (see
  `20260817120000_approved_not_activated_activation_gate.sql:317`). The
  iOS-flavored name is now a documented cosmetic wart, not a rename task.
- **The client env flag is dropped entirely**, rather than being ANDed with the
  server capability. Two flags — one baked into the binary, one server-side —
  is what produced this defect. The server flag becomes the single source of
  truth, so the kill switch works in both directions with no rebuild.
- **`source` stays explicit per platform:** `native_ios` is kept and
  `native_android` added, preserving existing analytics rows. This needs the
  `stripe_checkout_sessions_source_check` constraint extended in the same
  migration.

## The problem (found 2026-08-02, founder report from latest Android build)

An approved-but-not-activated merchant on Android sees the "Approved for setup"
card (`components/merchant-access-blocked-card.tsx`) whose body copy —
`merchantAccess.verifyBody` in en/es/ko — ends with:

> "On eligible iPhone builds, secure Checkout may also be available."

Three defects stack up:

1. **Platform leak.** The string is shared; Android merchants are told about
   iPhone builds. Confusing and useless to them.
2. **False promise everywhere.** On iOS the button renders (client env flag
   `EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT=true` is baked into the 1.0.2 binary,
   `eas.json:43`), but the server kill switch `ios_trial_checkout` ships
   `enabled=false` (`supabase/migrations/20260824150000_ios_trial_checkout_kill_switch.sql`)
   and `stripe-create-checkout-session/index.ts:364` rejects `source=native_ios`
   while it is off. So the iOS button is a dead control: tap → server refusal →
   `merchantAccess.checkoutUnavailable` fallback. Checkout is available on **no**
   shipping build today.
3. **Android has no self-serve activation at all.** `isIosTrialCheckoutEnabled()`
   (`lib/billing-activation.ts:29`) returns false on Android *even when the flag
   is true* — deliberate. An Android merchant's only activation paths are the
   single-use Stripe link in the approval email, or support. If the email is
   lost or unread (e.g. in-person approvals), support is the sole path.

Root structural flaw: **button visibility is decided by a client-baked env
flag, but success is decided by a server flag the client never reads.**
Capability-dark should be dark (invisible), not broken (visible + failing).

## Constraints

- 1.0.2 ships vc61 unmodified — **never respin** (decision recorded in
  `docs/plans/production-app-1.0.2-update-plan-2026-08-01.md`). All client
  changes here ride the **1.0.3 binary**, alongside the s10-qa-remediation
  workstreams B2/C/D.
- Server-side changes (Edge Functions / capabilities payload) deploy
  independently, any time.
- `lib/functions.ts` is poster-lock protected — do not touch it; none of the
  files in scope here are in the lock (verify with the pretest gate anyway).

## Decisions needed before implementation

1. **When does `ios_trial_checkout` flip ON?** The 1.0.2 launch decision was
   capability-dark with disclosure work (privacy policy, review notes,
   storefront confirm) required before submission. If the flip is imminent
   post-launch, the shipped 1.0.2 iOS button starts working on its own and the
   dead-button window is short. If the flip is indefinite, Phase 2+3
   (server-gated visibility) matters more, not less. Either way the copy fix
   stands.
2. **Should Android get the same self-serve Checkout button?** (RECOMMEND: yes.)
   The server path is platform-agnostic (`userCanBillBusiness` auth, no emailed
   token needed); the exclusion is one line in `isIosTrialCheckoutEnabled()`.
   Twofer deals are physical services, which Google Play's payments policy
   exempts from Play Billing, so an external Stripe checkout on Android is the
   same policy posture as the emailed link the app already relies on. This
   directly fixes the reported scenario: an in-person-approved Android merchant
   activating on the spot instead of digging for an email. If accepted, the
   flag/plumbing should be renamed platform-neutral (see Phase 3) and `source`
   values decided (keep `native_ios` + add `native_android`, or a single
   `native_app` — constraint change in `stripe_checkout_sessions_source_check`).

## What landed 2026-08-02 (code complete, UNCOMMITTED, nothing applied/deployed)

All three phases are built. Gates: `typecheck` 0, `typecheck:functions` 0,
`vitest` **2235/2236**, `lint` 0 errors 0 warnings, `check:i18n-keys` PASS,
`gate:release-state` PASS.

- `supabase/migrations/20260825120000_native_trial_checkout_capability.sql`
  (NEW) — `can_activate_trial_checkout` on the RPC + `native_android` allowed on
  `stripe_checkout_sessions_source_check`. Never touches the flag row.
- `stripe-create-checkout-session/index.ts` — `native_android` accepted;
  `iosTrialCheckoutEnabled` → `nativeTrialCheckoutEnabled` +
  `isNativeSource()`; error code `IOS_…` → `NATIVE_TRIAL_CHECKOUT_DISABLED`
  (no client keys off the old code, verified).
- Client: `lib/billing-activation.ts` (env flag + `Platform.OS` gate deleted,
  `nativeCheckoutSource()` added), `lib/business-capabilities.ts`,
  `lib/merchant-access.ts`, `hooks/use-trial-activation.ts`,
  `hooks/use-primary-location-billing-gate.ts` (fail-closed),
  `components/merchant-access-blocked-card.tsx`, and all three card call sites.
- Copy: **6 strings, not 3** — the same iPhone sentence also lived in
  `createHub.setupApprovedBody`. Removed from `merchantAccess.verifyBody` AND
  `createHub.setupApprovedBody` in en/es/ko.
- `eas.json` — dead `EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT` removed from both
  profiles; `docs/release-audit/generated-state.*` regenerated to match.
- Tests: `_shared/ios-trial-checkout-source.test.ts` →
  `native-trial-checkout-source.test.ts` (rewritten, +2 regression guards: the
  migration must not write `feature_flags`, and the copy must not name a
  platform); `billing-activation.test.ts` Android case inverted from "never
  invokes" to "reports native_android"; `merchant-access.test.ts`,
  `billing-functions-source.test.ts` updated.

**FLAG FLIPPED 2026-08-02 (Dan: "flip it").** `20260825130000_enable_native_trial_checkout.sql`
applied to prod (guarded `UPDATE ... WHERE key = 'ios_trial_checkout'` with a
`NOT FOUND` exception, following the same pattern as
`20260822191000_enable_production_stripe_billing.sql`). Ledger drift after: 0/194.
Committed `f762f8c6`. **Native trial Checkout is now live for approved-but-
not-activated merchants on both iOS and Android.** Not yet device/click-
verified end-to-end (would need a real approved-not-activated merchant
session — Dan-gated, no test credentials available here).

**Original three action items below, all now closed except #3:**
1. Apply `20260825120000` in prod. Until then the client reads no capability,
   `can_activate_trial_checkout` parses false, and the button stays hidden —
   fail-closed, so applying late is safe, not breaking.
2. Flip `ios_trial_checkout` to `enabled = true` (the imminent flip). Order does
   not matter; the button appears only once **both** are done.
   Deploy `stripe-create-checkout-session` before or with the flip.
3. **Website legal copy contradicts the Android decision (found in the
   2026-08-02 self-review).** `privacy.noSaleBody` and
   `businessTerms.billingBody` (en/es/ko in `website/localization.js`, plus the
   baked English in `website/privacy/index.html:111` and
   `website/business-terms/index.html:85`) say billing happens "on eligible
   iPhone builds" and that "Android does not provide Checkout or
   external-payment links." That sentence becomes FALSE once the flag flips
   with the 1.0.3 client live. Because this is privacy-policy/business-terms
   (disclosure) text, the wording change is Dan's call — but it must ship
   before or with Android's button, and it follows the website checklist
   (en/es/ko together, `?v=` bump on any pinned file). Note: while only the
   1.0.2 binary is live the current text stays TRUE (1.0.2 Android has no
   button baked in), so this rides the 1.0.3 timeline, not the flag flip
   itself.

**Pre-existing branch defect found, NOT mine, NOT fixed (needs Dan):**
`npm test`'s pretest gate fails on branch tip `cc4daefb` — that commit changed
the locked `app/create/ai.tsx` without updating `docs/ai-poster-core-lock.json`.
Proof: HEAD's blob hashes to `8f044e71…`, exactly the "got" value the gate
reports, while the lock still expects `c3750e3d…` (last set in `6ec63815`).
The file is byte-identical to HEAD in my tree — I never touched it. Per the lock
protocol the hash may only be updated with Dan's explicit per-file approval, so
this is left alone. It blocks `npm test` for everyone on this branch until
resolved; `npx vitest run` is unaffected.

## Workstreams

### Phase 1 — copy stops describing capability (1.0.3 binary)

The card's *button* should be the only signal that Checkout exists. Copy should
never promise what a flag may deny.

- [ ] `merchantAccess.verifyBody` (en/es/ko): delete the trailing
      capability sentence ("On eligible iPhone builds…" / es / ko variants).
      Keep: finish setup + activate via approval email or support.
- [ ] Keep `merchantAccess.checkoutUnavailable` unchanged — it is the honest
      failure fallback and already correct.
- [ ] Before deleting, confirm the sentence is not referenced in the Apple
      disclosure package (grep `docs/release/`, review notes in the 1.0.2 plan).
- [ ] Gates: `npm run check:i18n-keys` parity; i18n defaultValue masking check
      (the key exists in all 3 locales, so no silent-English risk).

### Phase 2 — server-confirmed capability (Edge Functions, deployable now)

- [ ] Add `can_activate_trial_checkout: boolean` to the canonical capabilities
      payload (`supabase/functions/_shared/business-capabilities.ts` + wherever
      the payload is computed for `get-business-onboarding-context`). True iff
      the business is `approved_not_activated` with a claimed application AND
      the `ios_trial_checkout` feature flag (renamed per Decision 2 if
      accepted — e.g. `native_trial_checkout`; keep the old key as an alias or
      migrate the row, do NOT strand the prod flag row) is enabled.
- [ ] Old clients ignore the unknown key — no compatibility risk. New clients
      treat absence as `false` (parser already defaults) — fail-closed.
- [ ] Source-contract tests: extend `_shared` capability tests to pin the new
      key and its gating inputs.
- [ ] Deploy: `get-business-onboarding-context` (+ any other fn embedding the
      shared module that matters here). Use Bash tool for
      `npx supabase functions deploy`, one fn per call (PowerShell blocked).

### Phase 3 — client gating (1.0.3 binary)

- [ ] `lib/business-capabilities.ts`: add `can_activate_trial_checkout` to
      `CanonicalBusinessCapabilities` + `BOOLEAN_KEYS`.
- [ ] Thread the boolean into `MerchantAccessBlockedCard` (via
      `MerchantAccessResult` in `lib/merchant-access.ts`, which already carries
      status/reason from capabilities) — three call sites: dashboard, create,
      account tabs.
- [ ] `useTrialActivation` / `isIosTrialCheckoutEnabled()`: button renders only
      when `envFlag && serverCapability` (and, per Decision 2, either
      `Platform.OS === "ios"` stays or the platform check is dropped and the
      function is renamed `isTrialCheckoutEnabled`). Result: kill switch OFF →
      button invisible on every platform; ON → button works when tapped.
- [ ] Tests: `lib/billing-activation.test.ts`, `lib/merchant-access.test.ts`,
      `lib/business-capabilities.test.ts` updated for the new gate.
- [ ] Gates: `npm run typecheck`, `npm run typecheck:functions`, `npm test`,
      `npm run lint`, `npm run check:i18n-keys`, poster-lock pretest.

### Phase 4 — shipped 1.0.2, interim posture (no code)

- [ ] Nothing to change: Android behavior is correct (only the copy misleads,
      and that is binary-bound); the iOS dead button degrades to the honest
      `checkoutUnavailable` message. Do not respin.
- [ ] If/when Dan flips `ios_trial_checkout` ON (post-disclosure), the 1.0.2
      iOS button starts working as originally designed — no deploy needed
      beyond the flag row UPDATE (Dan runs prod SQL).

## Sequencing

Phase 2 (server) can land immediately and is inert until a client reads the new
key. Phases 1+3 ride the 1.0.3 binary together with s10-qa-remediation B2/C/D.
Decision 2 only changes Phase 3's platform check + naming; build Phases 1–2 the
same either way.

## Explicitly out of scope

- Flipping the `ios_trial_checkout` prod flag (Dan-gated SQL, disclosure work
  first).
- Any change to the emailed activation link or approval-email flow.
- The pre-approval "Apply now" screen (`app/business-setup.tsx` pending view) —
  verified working as designed; not part of this defect.
