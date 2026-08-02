# S10 QA findings — remediation plan

Date: 2026-08-02
Status: PROPOSED — decisions 1–2 below need founder sign-off before code starts
Source: `docs/qa/S10_PRODUCTION_1.0.2_ANDROID_QA_2026-08-02.md` (full evidence)
Convention: this plan file IS the tracker; check items off here as they land.

## What the QA pass found

| # | Finding | Severity | State |
|---|---------|----------|-------|
| 1 | Google Wallet pass declared wrong Android package (`twoferone`) | High | **FIXED + DEPLOYED** (7 Edge Functions, 2026-08-02) + cross-file guard added |
| 2 | Wallet pass-to-app button never renders — `appLinkData` shape violates Google's schema | High | Open — workstream B |
| 3 | Releasing a claim never returns deal inventory (display AND cap enforcement) | High | Open — workstream A |
| 4 | "Add to Google Wallet" badge hidden device-wide once any account taps it | Low | Open — workstream C |
| 5 | Publish success banner says "now live" for a future-scheduled deal | Trivial | Open — workstream D |
| 6 | AI poster headline rendered garbled/truncated on a live customer-facing deal | High (visibility) | Open — workstream E |

Everything else on the ten Android gates passed on the exact vc61 payload; the
QA report has the per-gate detail.

## Decisions needed before implementation

1. **Inventory semantics (workstream A):** should a released claim free its
   slot? The release dialog already promises it does ("the deal becomes
   available again"). **Recommendation: yes** — make the code match the copy.
   Churn risk (claim/release cycling) is bounded by the existing
   one-active-claim rule and 15-min claim cutoff; add rate limiting later only
   if abuse appears.
2. **Release strategy for 1.0.2:** **Recommendation: ship vc61 as planned.**
   Do NOT respin the binary — that would invalidate all §6 exact-binary QA.
   Workstreams A and B-phase-1 are server-side and deploy independently of the
   store release; B-phase-2, C, D ride the next binary (1.0.3). If B-phase-1
   makes an "open app" button render on the pass (plausible — see below), the
   1.0.2 wallet gate closes as pass-with-note; if not, record it as a known
   issue and ship anyway (pass save, QR, and staff scan all work — pass-to-app
   is a convenience path).
3. **Badge scoping (C):** accept "once per device" as intentional, or scope
   per user? **Recommendation: per-user key in 1.0.3**; trivial change.
4. **Deferred follow-ups (decide later, not blockers):** (a) whether the
   merchant dashboard "Claims" metric should keep counting released claims as
   engagement even after they stop consuming inventory (recommend yes —
   analytics ≠ inventory); (b) whether `expired` claims should free inventory
   on **recurring** deals, where one deal row spans many windows and stale
   claims accumulate against `max_claims` forever — likely a real latent bug
   for recurring deals, needs its own look.

---

## Workstream A — released claims must free inventory (server-only, no binary)

Root cause: `release-claim` writes `claim_status = 'released'`
(`supabase/functions/release-claim/index.ts:119`; status added to the check
constraint by `20260721120000_deal_wallet_redemption_rules.sql:138`), but every
counting site still excludes only `'canceled'` — a status nothing writes
anymore. Sites, all must change in lockstep:

| Site | Where | Role |
|------|-------|------|
| `enforce_deal_max_claims()` trigger | `20260704130000_enforce_max_claims_atomic.sql:36` | **Authoritative cap gate** (FOR UPDATE serialized) |
| `claim-deal` pre-check | `supabase/functions/claim-deal/index.ts:713` | Fast-path cap check |
| `claim-deal` owner-push count | `supabase/functions/claim-deal/index.ts:873` | Feeds `decideOwnerClaimPush` sold-out signal |
| `deal_claim_counts` RPC | `20260716120000_deal_claim_counts_rpc.sql:22` | All consumer-facing "N claims available" / sold-out UI |

- [ ] New migration: `CREATE OR REPLACE` both `enforce_deal_max_claims()` and
      `deal_claim_counts(uuid[])` with
      `claim_status NOT IN ('canceled', 'released')`. Same signatures, body
      only — no overload risk (the PGRST203 trap applies only when adding
      DEFAULT params). Update the "match claim-deal's cap counting" comments
      on both so the invariant stays discoverable.
- [ ] `claim-deal/index.ts` :713 and :873 → exclude both statuses
      (`.not("claim_status", "in", "(canceled,released)")` or equivalent).
- [ ] Add a source-sync test asserting all four sites agree on the exclusion
      list — this bug existed precisely because the constraint gained a status
      and no counting site followed. Model it on the existing
      `wallet-pass-source.test.ts` guards.
- [ ] Keep the release-dialog copy as-is (it becomes true). The existing
      `lib/wallet-release-confirm.test.ts` stays valid.
- [ ] Apply migration to prod (`supabase db push` per runbook), redeploy
      `claim-deal` (Bash tool, one function per call — PowerShell is blocked
      by the permission classifier), then run the RLS/edge smoke gates.
- [ ] Device verify: publish a throwaway deal capped at 10 → claim (9) →
      release → **detail page must read 10 again** → re-claim (9) → merchant
      dashboard still shows both claims in history.

## Workstream B — Wallet pass-to-app button (phase 1 server, phase 2 binary)

Root cause (verified against Google's live docs, not memory):
`buildGoogleWalletGenericObject` (`wallet-pass-content.ts:420-431`) sets
`appTarget.packageName` **and** `appTarget.targetUri` together, but `appTarget`
is a **union field** — one or the other. And `androidAppLinkInfo` cannot
deep-link to a specific view at all: Google states *"To deep link to a specific
view within an app you must use webAppLinkInfo"* with an https App Link. The
custom `twofer://wallet?pass=1` scheme in that slot can never work. The code
also fills `title`/`description` inside `androidAppLinkInfo`, which are
deprecated; `displayText` (top-level, ≤30 chars) is current.

### Phase B1 — correct the object shape (Edge Functions, deployable now)

- [ ] Rework `appLinkData` to Google's documented pattern:
      `androidAppLinkInfo.appTarget = { packageName }` **alone** (renders an
      open-the-app action), `webAppLinkInfo.appTarget.targetUri =
      https://www.twoferapp.com/wallet` (browser fallback today, deep link
      after B2), top-level localized `displayText` replacing the deprecated
      title/description. Keep the attach-only-when-`active_deal` behavior.
- [ ] Retire `WALLET_PASS_APP_DEEP_LINK` from the Google object (the in-app
      `twofer://wallet?pass=1` handler stays — it works and B2 reuses it).
- [ ] Update `wallet-pass-content.test.ts` to the new shape; keep the
      app.json↔constant source-sync guard from 2026-08-02.
- [ ] Website: add a real `/wallet` page (open-the-app guidance + store links).
      Mind the Vercel trap: static files resolve before rewrites, so ship it as
      a real static page, and never let a stray `wallet/index.html` shadow
      future routing.
- [ ] Deploy the 7 wallet-touching functions (same list as the typo fix);
      re-save a pass on device. **If the app-open action now renders and
      launches Twofer, close the 1.0.2 wallet gate as pass-with-note.**

### Phase B2 — true deep link to the pass sheet (1.0.3 binary)

- [ ] `app.json`: add an `autoVerify: true` intent filter for
      `https://www.twoferapp.com` with `pathPrefix: "/wallet"` (today only
      `/s` is verified). Intent filters compile into AndroidManifest — this is
      what forces the binary.
- [ ] Map `/wallet` in expo-router linking to the Wallet tab with the existing
      `pass=1` param handling (`app/(tabs)/wallet.tsx:621` already implements
      the sheet-open behavior).
- [ ] Re-verify on device: pass → "Open Twofer" → app opens directly to the
      staff pass sheet (no chooser, no browser).

## Workstream C — per-user "pass added" flag (1.0.3 binary)

`components/add-to-wallet-button.tsx:48` hides the badge when the global
AsyncStorage key `twoforone.consumer.native_wallet_pass_added`
(`lib/native-wallet-pass-storage.ts:9`) is set — no user id, so one account's
tap hides it for every account on the device.

- [ ] Namespace the key by user id; ignore the legacy key (worst case the
      badge shows once more per user — harmless, Wallet dedupes saves).
- [ ] Unit test: two user ids on one device get independent flags.

## Workstream D — "now live" banner on scheduled publish (1.0.3 binary)

Observed: publishing at 12:04 for a 12:10–1:10 window showed "…is now live for
customers" while the dashboard correctly showed Scheduled / 0 live.

- [ ] Locate the publish-success copy in the AI-ads flow; when
      `start_time > now`, say "scheduled for {time}" instead. All three
      locales + i18n key test.

## Workstream E — AI poster headline garbled/truncated on a live deal (needs investigation before a fix)

Spotted live on device 2026-08-02 17:21: a real, non-demo, customer-claimable
deal's AI-generated poster image showed **"S STRIPES FOR LESS"** where the
intended headline was almost certainly something like "THE SERGEANT'S STRIPES
FOR LESS" — the pattern (missing beginning, intact end) reads as the AI image
model failing to render the full headline into the image pixels, not a string
bug in app code. The one candidate app-side function
(`ai-generate-ad-variants/index.ts:277` `clip()`) truncates from the end, the
opposite pattern, and was ruled out. The deal's non-image data (title, price,
overlay text) was correct throughout — this is specific to the baked poster
image.

- [ ] **Root-cause first, don't guess-fix.** Pull the exact `posterHeadlineText`
      value and the exact prompt sent to the image model for this specific
      deal (needs prod data access this session didn't have) to confirm
      whether the input text was already correct (→ image-model rendering
      defect) or already truncated before generation (→ app bug, different
      fix).
- [ ] If image-model rendering: this is the same category as prior
      "headline invisible on dark photos" findings — check whether the
      existing poster-quality harness (`docs/plans/poster-quality-plan...`
      lineage, referenced in project memory) already covers headline-fidelity
      checks, or needs a new automated check for baked-in-text accuracy
      (e.g., OCR-diff the generated image against the intended headline before
      allowing publish).
- [ ] If confirmed as an image-fidelity failure with no cheap server-side fix:
      at minimum, add a client or server sanity check comparing OCR'd poster
      text against the intended headline before a merchant can publish, so a
      garbled poster blocks publish instead of shipping to real customers.
- [ ] Until root-caused, do not assume this is rare — it happened on the very
      next AI-generated poster produced during this same QA session, from a
      previously-working headline ("THE STRIPES ARE CALLING" rendered
      correctly earlier the same session on a near-identical deal), so it is
      not a one-off with obviously unusual input.

## Optional hardening (no decision needed, cheap)

- [ ] Sweep other unit tests for the vacuous-guard pattern (a test asserting
      the same hardcoded literal as the source, rather than cross-referencing
      config) — that pattern let bug #1 ship. Start with constants that mirror
      `app.json` / `eas.json` values.

## Sequencing

1. Decisions 1–2 recorded → A and B1 implemented together (both are Edge
   Function + migration work, one test/gate cycle: full vitest,
   `typecheck:functions`, deploy per-function via Bash, hosted smoke).
2. Device re-verify A (inventory cycle) and B1 (pass button) same session.
3. 1.0.2 store release proceeds per its own plan — unaffected by A/B1, wallet
   gate closed or noted per B1's outcome.
4. B2 + C + D batch into the 1.0.3 train with the usual exact-binary QA.
