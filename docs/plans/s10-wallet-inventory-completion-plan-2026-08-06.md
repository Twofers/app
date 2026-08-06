# S10 correctness completion — wallet pass-to-app + inventory verify + per-user badge

Date: 2026-08-06
Status: APPROVED to implement (Dan directive 2026-08-06: top-3 improvements batch)
Parent: `docs/plans/s10-qa-remediation-plan-2026-08-02.md` (workstreams B1/B2/C live here; this doc supersedes its stale checkboxes)
Convention: this plan file IS the tracker; check items off as they land.

## State corrections as of 2026-08-06 (verified, not from docs)

- **Workstream A (released claims free inventory): migration
  `20260824151000_released_claims_free_inventory.sql` IS APPLIED to prod** —
  confirmed via `supabase migration list --linked` 2026-08-06 (local==remote
  through `20260825140000`). The parent plan's "apply migration" box is stale.
  Remaining A work is verification only (§A below).
- **F-21 (comped-merchant lockout) is CLOSED** — link-don't-rewrite fix
  applied to prod 2026-07-24 and verified live
  (`docs/plans/claim-links-activated-business-plan-2026-07-24.md` §9.1).
  Not part of this batch despite older docs calling it open.
- Workstream D (scheduled-publish banner) done in code; E (poster headline)
  deployed, app-rebuild-dependent parts ride the next binary.
- **Workstream B is NOT started**: `wallet-pass-content.ts:420-431` still
  sets `androidAppLinkInfo.appTarget` with BOTH `packageName` and `targetUri`
  (union field violation) plus deprecated `title`/`description` — the exact
  shape Google rejects for rendering the button.

## Workstream B1 — correct the Google Wallet object shape (edge fns, deployable now)

Per Google's documented schema (see parent plan §B root cause):

- [ ] `buildGoogleWalletGenericObject` (`supabase/functions/_shared/wallet-pass-content.ts:414-431`):
      - `androidAppLinkInfo.appTarget = { packageName: WALLET_PASS_ANDROID_PACKAGE }`
        ALONE (renders the open-the-app action).
      - Add `webAppLinkInfo.appTarget.targetUri = https://www.twoferapp.com/wallet`
        (browser fallback today; becomes the deep link after B2).
      - Replace deprecated per-platform `title`/`description` with top-level
        localized `displayText` (≤30 chars per locale — check en/es/ko copy
        lengths).
      - Keep the attach-only-when-`active_deal` gate (:420) exactly as-is.
- [ ] Remove `WALLET_PASS_APP_DEEP_LINK` from the Google object only — the
      in-app `twofer://wallet?pass=1` handler stays (B2 reuses it).
- [ ] Update `wallet-pass-content.test.ts` to pin the NEW shape (union field:
      assert `targetUri` is ABSENT from androidAppLinkInfo.appTarget); keep
      the app.json↔constant package-name source-sync guard from 2026-08-02.
- [ ] FOUNDER GATE: deploy the 7 wallet-touching functions (same list as the
      2026-08-02 package-name fix), then re-save a pass on device. If the
      open-app action renders → close the wallet gate as pass-with-note.

## Workstream B1b — real `/wallet` page on the website

- [ ] Add a static `/wallet` page: one-screen "open the Twofer app" guidance
      + both store links (App Store live; Play Store 1.0.2). Match existing
      website styling; en copy only is fine for the website (site is
      en/es-aware — follow whatever the existing pages do).
- [ ] Vercel trap: static files resolve BEFORE rewrites — ship it as a real
      static page and never let a stray `wallet/index.html` shadow future
      routing. Verify no existing rewrite/redirect claims `/wallet`.
- [ ] FOUNDER GATE: website deploy MUST use build → prepare-deploy →
      `--prebuilt` (established pipeline).

## Workstream B2 — true deep link to the pass sheet (binary)

- [ ] `app.json`: add `autoVerify: true` intent filter for
      `https://www.twoferapp.com` with `pathPrefix: "/wallet"` (only `/s` is
      verified today). Compiles into AndroidManifest → forces the store
      build. `.well-known/assetlinks.json` already exists for the `/s` App
      Link on the same host — verify it's fingerprint-correct, no change
      expected.
- [ ] Map `/wallet` in expo-router linking to the Wallet tab preserving the
      existing `pass=1` sheet-open behavior (`app/(tabs)/wallet.tsx:621`).
- [ ] Unit/source test for the linking config; device verify rides the next
      binary QA: pass → "Open Twofer" → app opens to the staff pass sheet.

## Workstream C — per-user "pass added" flag (binary)

`components/add-to-wallet-button.tsx:48` hides the badge via the global
AsyncStorage key `twoforone.consumer.native_wallet_pass_added`
(`lib/native-wallet-pass-storage.ts:9`) — one account's tap hides it for
every account on the device.

- [ ] Namespace the key by user id; ignore the legacy key (worst case the
      badge shows once more per user — Wallet dedupes saves).
- [ ] Unit test: two user ids on one device get independent flags.

## Workstream A — verify released-claims inventory end to end (no code expected)

- [ ] Confirm the DEPLOYED `claim-deal` excludes `released` at both counting
      sites (:713 pre-check, :873 owner-push) — use the safe
      `supabase functions download --workdir <scratch>` trick, never into the
      working tree.
- [ ] If the deployed copy predates the fix → FOUNDER GATE: redeploy
      `claim-deal` (Bash, one function per call).
- [ ] Device verify (founder or next S10 session): cap-10 deal → claim (9) →
      release → detail reads 10 → re-claim (9) → dashboard history keeps both.

## Sequencing

1. B1 + B1b + C + B2 code in one pass (single test/gate cycle: focused
   vitest, `npm run typecheck:functions`, `npm run typecheck`).
2. A-verify (read-only download + diff).
3. Founder deploys: 7 wallet fns; website `--prebuilt`; `claim-deal` only if
   stale. B2 + C ride the next store binary with its exact-binary QA.
