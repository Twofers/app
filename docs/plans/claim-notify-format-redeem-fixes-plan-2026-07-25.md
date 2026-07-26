# Execution plan for Opus: claim copy, repeat-push, menu→poster, double-tap redeem, wallet pass

Date: 2026-07-25 (revised same day after Dan's review)
Branch at time of audit: `qa/poster-ad-quality`
Status: READY FOR IMPLEMENTATION — this file is the tracker; check boxes off as you go.
Read `CLAUDE.md` hard gates before starting. Items are ordered; each is one scoped task.

## Decision log (Dan, 2026-07-25)

- **D trust model: ACCEPTED RISK.** Customer-device double-tap may be used away
  from the store; it only burns the customer's own claim ("they won't get any
  food"). Do not add staff-proof mechanisms. Record as accepted risk, same
  pattern as the C2 accepted-risk note.
- **D UX: no time gating of any kind.** No delayed hint reveal, no countdown.
  A short hint is always visible: "Tap the QR twice to redeem" (or equally
  short). The only guardrail is a branded confirm so an accidental double-tap
  can't burn a claim.
- **B failure mode: fail-open by default.** If the policy/redemption lookup
  errors, send to everyone (today's behavior). Matches the philosophy in
  `lib/repeat-claim-visibility.ts:12-16`. Only escalate to Dan if
  implementation finds a concrete reason to fail closed.
- **Still requiring explicit in-session approval from Dan before acting:**
  every locked-file edit in C, and every edge-function deploy (B, D-server, E).

---

## A. Second claim shows "Something went wrong" instead of a real reason

**Severity: high. No locked files. No deploy. Do this first.**

**STATUS: ✅ DONE 2026-07-25.** Uncommitted. Client-only, so it ships with the
next rebuild — no deploy needed. Validation: `typecheck` clean, `lint` clean
(0 problems), `vitest` 2014/2014 across 286 files, `check:i18n-keys` PASS,
`gate:ai-poster-lock` 30/30 hashes intact (no locked file touched).
Files changed: `lib/i18n/api-messages.ts`, `lib/i18n/api-messages.test.ts`,
`lib/i18n/locales/{en,es,ko}.json`, `components/ui/banner.tsx`,
`app/deal/[id].tsx`, `app/(tabs)/index.tsx`.
Device QA still owed: claim a deal, try to claim a second → confirm the real
message + "Go to my wallet" button on both the feed and the deal page.

### Root cause

`claim-deal` returns 409 with a clear message and
`error_code: "CUSTOMER_ALREADY_HAS_ACTIVE_DEAL"`
(`supabase/functions/claim-deal/index.ts:600-613`). The client translates
errors by **exact English string** in `API_MESSAGE_KEY`
(`lib/i18n/api-messages.ts:7-96`); the table has two *older* wordings of this
sentence but not the current one, so `translateKnownApiMessage` masks it with
`apiErrors.operationFailedTryAgain` = "Something went wrong. Try again."
Proof of drift: `classifyClaimBlockReason` (`app/(tabs)/wallet.tsx:117`) *was*
updated for the new wording; the copy table wasn't.

Also masked the same way (fix in the same pass):

| Server string | Source |
| --- | --- |
| "This business limits deals to first-time Twofer customers. You have already redeemed a deal here." | `_shared/repeat-claim-policy.ts:29` (`BUSINESS_REPEAT_LIMIT_FOREVER`) |
| "You can claim another deal from this business on {ISO}." | `_shared/repeat-claim-policy.ts:43` (`BUSINESS_REPEAT_LIMIT_COOLDOWN`) — also leaks a raw ISO timestamp |
| "This deal is not eligible to claim." | `claim-deal/index.ts:322` (`DEAL_NOT_ELIGIBLE`) |
| "This business is not accepting new deal claims." | `claim-deal/index.ts:636` (`BUSINESS_NEW_CLAIMS_DISABLED`) |

### Steps

- [x] **Code-first translation (the structural fix).** Added `API_ERROR_CODE_KEY`
  + `translateApiError({ code, message }, t)`. Resolution order ended up
  message-first → code → heuristics → mask: the message branch is the only one
  that can interpolate a cutoff time or cooldown date, and it simply misses when
  the backend rewords, so the code still catches drift. Add to
  `lib/i18n/api-messages.ts` an error-code → i18n-key map and a helper, e.g.
  `translateApiError(params: { code?: string | null; message: string }, t)`:
  try the code map first, fall back to the existing string pipeline. Codes to
  map: `CUSTOMER_ALREADY_HAS_ACTIVE_DEAL`, `BUSINESS_REPEAT_LIMIT_FOREVER`,
  `BUSINESS_REPEAT_LIMIT_COOLDOWN`, `DEAL_NOT_ELIGIBLE`,
  `BUSINESS_NEW_CLAIMS_DISABLED`. This ends the "server reworded a sentence,
  client shows generic error" failure class for coded errors.
  - `lib/functions.ts` already throws with the code
    (`throwInvokeError(message, code)`, `lib/functions.ts:227-254`) — it is a
    **locked file; do not edit it**. Verify the thrown error's shape (how the
    code rides on the Error object) and add a `codeFromThrown` companion next
    to `messageFromThrown` on the screens.
- [x] **String-table entries as fallback** (older deployed fn versions, uncoded
  paths): add the four current sentences above plus the app-wide-active one to
  `API_MESSAGE_KEY`. Keep the two legacy variants.
- [x] **Cooldown date, no ISO leak.** Added a prefix entry (pattern:
  `CUTOFF_PREFIX`, `lib/i18n/api-messages.ts:98,139-141`) for
  `"You can claim another deal from this business on "`; parse the ISO suffix,
  format via `Intl.DateTimeFormat` in the device locale, interpolate into the
  new key (e.g. `apiErrors.claimRepeatCooldown` = "You can claim another deal
  here on {{date}}.").
- [x] **Rewrite `apiErrors.claimActiveAppWide`** in `en/es/ko.json` to Dan's
  meaning, short: EN "You can only claim one deal at a time. Redeem or release
  the deal in your wallet first." Write ES/KO by hand (no machine accents —
  see feedback memory). New keys likewise: repeat-forever (EN "You've already
  redeemed a deal here. This business limits deals to first-time customers."),
  not-eligible, new-claims-disabled. Locale JSON is NOT poster-locked.
- [x] **Escape hatch.** Added an optional `actionLabel` prop to
  `components/ui/banner.tsx` (backward compatible — existing call sites keep
  "Tap to retry") so the banner can offer "Go to my wallet". When the code is
  `CUSTOMER_ALREADY_HAS_ACTIVE_DEAL`,
  show a "Go to wallet" action with the banner on **both** main claim
  surfaces: `app/deal/[id].tsx` (catch at ~:573-585) and the feed
  `app/(tabs)/index.tsx` (catch at ~:799-813). The 409 body also carries
  `activeClaimId` if useful.
- [x] **Regression tests** (7 added, 21 pass in that file) in
  `lib/i18n/api-messages.test.ts`: each of the five
  raw server strings translates to something ≠ the generic fallback; code-map
  hits win over string misses; cooldown prefix formats a date and contains no
  raw ISO.

### Files
`lib/i18n/api-messages.ts`, `lib/i18n/api-messages.test.ts`,
`lib/i18n/locales/{en,es,ko}.json`, `app/deal/[id].tsx`,
`app/(tabs)/index.tsx`. **Do not touch `lib/functions.ts` (locked).**

### Validation
`npm run typecheck`, `npm run lint`, `npm test`, `npm run check:i18n-keys`
(CI-only gate — run locally). Client-only; no deploy.

---

## B. Repeat-restricted customers still get "new deal" pushes

**Severity: medium. No locked files. Deploy is Dan-gated.**

**STATUS: ✅ CODE DONE 2026-07-25, ⏳ NOT DEPLOYED.** Uncommitted. The client
half (deal-detail dead-end fix) ships with the next rebuild and needs no deploy.
The push filter does **nothing in production until `send-deal-push` and
`weekly-deal-digest` are deployed** — Dan-gated.
Validation: `typecheck` clean, `typecheck:functions` exit 0, `lint` 0 problems,
`vitest` 2028/2028 across 287 files (14 new), `check:i18n-keys` PASS,
`gate:ai-poster-lock` 30/30 intact.
New: `_shared/repeat-claim-audience.ts` (+ 9 tests). Changed:
`_shared/digest-targeting.ts` (+ 5 tests), `send-deal-push/index.ts`,
`weekly-deal-digest/index.ts`, `app/deal/[id].tsx`, locales.
Device QA owed: as a customer who already redeemed at a FOREVER-restricted
business, open that business's new deal by direct link → Claim button should read
"Already used here" instead of erroring on tap.

### Root cause

`sendDealPushToAudience` (`supabase/functions/send-deal-push/index.ts:234-325`)
filters by favorites + `deal_alerts_enabled` + `notification_mode` only —
never by `businesses.repeat_claim_policy_type`. The feed already hides these
deals (`lib/repeat-claim-visibility.ts`), so the push deep-links a blocked
customer to `/deal/{id}`, which has **no repeat gate either**, where Claim
fails into bug A. `weekly-deal-digest/index.ts:94-121` has the same gap.

### Steps

- [x] **Shared helper** `supabase/functions/_shared/repeat-claim-audience.ts`.
  Built one primitive, `loadRepeatBlockedPairs(admin, businessIds, userIds)` →
  `Set<"userId::businessId">`, because the digest needs per-(user, business)
  blocking across many businesses while the push needs one business;
  `filterRepeatBlockedUserIds` is the single-business wrapper. Pure core
  `selectRepeatBlockedPairs` is separately unit-tested. Added `.in()` chunking
  (300 users/batch) so a large audience can't 414 into a silent fail-open.
  Original sketch:
  `filterRepeatBlockedUserIds(admin, businessId, userIds) -> allowedUserIds`.
  Read the business policy; if `NONE` return input unchanged (one cheap query,
  common case unchanged). Else **one** query over `deal_claims`
  (`user_id in (...)`, `business_id = X`, `claim_status='redeemed'`,
  `redeemed_at not null`, ordered `redeemed_at desc`) and first-row-per-user
  wins — the exact pattern of `loadBusinessRedemptionMap`
  (`lib/repeat-claim-visibility.ts:102-128`). Evaluate with the existing
  `evaluateRepeatClaimPolicy` from `_shared/repeat-claim-policy.ts` so the
  push filter can never drift from the claim gate. **Fail-open** on any error
  (decision log). Unit-test the helper.
- [x] **Deliberate non-change:** do NOT exclude users who merely hold an
  active claim right now — that's temporary; they can release/redeem and then
  claim. Only policy-blocked users are filtered. Note this in a comment.
- [x] Wired into `send-deal-push` (filters `allUserIds` in place, so the token
  query, locale fetch and audience counts all follow; reports `repeatBlocked` in
  the result, the `deal_push_events` metadata and the dispatch summary). For
  `weekly-deal-digest` the count is per (user, business), so `DigestConsumer`
  gained an optional `blocked_business_ids` and `computeDigestCounts` skips those
  deals — placed ahead of the favorites override, which otherwise counts a
  favorited shop regardless of distance and would have leaked exactly this case.
- [x] **Client dead-end fix (ships without any deploy):** folded into the
  existing `claimBlockedLabel` chain, so the whole CTA machinery (disabled
  button + status label) handles it with no new UI. Placed ahead of the sold-out
  check — "Sold out" would misdescribe a block caused by the customer's own
  history — and `getDealDetailActionState` still checks `hasActiveClaim` first,
  so someone already holding a claim on this deal keeps "View your deal". On
  `app/deal/[id].tsx`, use the existing `lib/repeat-claim-visibility.ts`
  helpers to detect the blocked state and replace the Claim button with short
  copy ("You've already redeemed a deal here.") for customers arriving via
  push/shared link.

### Files
`supabase/functions/_shared/repeat-claim-audience.ts` (new, + test),
`supabase/functions/send-deal-push/index.ts`,
`supabase/functions/weekly-deal-digest/index.ts`, `app/deal/[id].tsx`,
locales for the blocked-state copy.

### Validation / gates
`npm run typecheck`, `npm run typecheck:functions`, `npm test`.
**HARD GATE:** deploying `send-deal-push` + `weekly-deal-digest` needs Dan's
explicit approval (batch it with D's server deploy if both are ready).

---

## C. Promote-from-menu forces poster style with no visible option

**Severity: medium. TOUCHES LOCKED FILES — approval required BEFORE editing.**

**STATUS: ✅ DONE 2026-07-25.** Uncommitted. Approved by Dan via AskUserQuestion
("Approve — remove the auto-scroll") against the named file. Deleted the effect
and its `menuOfferScrollDoneRef`; `DEFAULT_CREATIVE_FORMAT` untouched.
`lib/create-ai-ux-source.test.ts` needed **no** edit (no contract pinned the
effect; all 34 assertions still pass), so exactly one locked file changed.
`docs/ai-poster-core-lock.json` updated: new sha256 + `latestApprovalRef`
chained with `Prior ref:` (13 links now), 2-line diff, no reformatting.
Validation: `typecheck`, `lint` 0, `vitest` 2031/2031, `gate:ai-poster-lock`
30/30, `gate:ai-ad` PASS (incl. copy evaluator).
**Device QA: ✅ PASSED on the S10 (2026-07-25)**, via the installed dev-client
(`com.unvmex2.twoforone.dev`) reloaded from a cleared Metro — the change is pure
JS, so no rebuild was needed. Create → Promote a menu item → Latte → buy one get
one → Generate strong ad: the create screen now lands at the **top**, showing the
prefill banner, Step 1 of 3, the **Ad style** toggle and the photo buttons.
Waited 5s, well past the old 400ms auto-scroll, and it did not move. Tapping
"Standard card" selects it, so the choice is real and not just visible. Poster
style remains pre-selected (DEFAULT_CREATIVE_FORMAT unchanged, as approved).
Screenshots: scratchpad `qa7_menu_to_create.png`, `qa8_standard_card.png`.
Not yet exercised: carrying a Standard-card choice all the way through publish.

### Root cause

The Standard/Poster toggle renders at the top of Step 1
(`app/create/ai.tsx:4949-5007`). The menu path always sets `fromMenuOffer=1`
(`app/create/menu-offer.tsx:250-259`), and an effect
(`app/create/ai.tsx:2459-2467`) auto-scrolls after 400 ms straight to the
Schedule section — past the toggle. Merchants never see the choice and land on
`DEFAULT_CREATIVE_FORMAT = "poster_v1"` (`ai.tsx:238`, pinned by
`lib/create-ai-ux-source.test.ts:298-300`). The default itself is fine and
stays; the fix is to stop hiding the switch.

### Steps

- [ ] (Optional but cheap) Reproduce on the S10 first via the `/sh` skill:
  Create → Promote from menu → watch the auto-scroll skip the toggle.
- [ ] **Get Dan's explicit per-file approval** (list file, exact change,
  validation impact, deploy impact — per CLAUDE.md):
  - `app/create/ai.tsx`: delete the `fromMenuOffer` auto-scroll effect
    (:2459-2467) and its `menuOfferScrollDoneRef`. No change to poster
    generation, prompts, layout, validation, or publish. No deploy impact.
  - `lib/create-ai-ux-source.test.ts`: only if an assertion covers the
    removed effect — grep found none, so likely untouched.
- [ ] After the approved edit: update `latestApprovalRef` in
  `docs/ai-poster-core-lock.json`, **chaining** the previous ref with
  "Prior ref:" (never overwrite).
- [ ] The `prefillFromMenuOffer` success banner renders above Step 1, so
  without the scroll the merchant sees banner → format toggle → photo →
  schedule in natural order. Alternative (only if Dan prefers): scroll to
  Step 1 instead of Schedule.

### Validation
`npm run typecheck`, `npm run lint`, `npm test`,
`npm run gate:ai-poster-lock`. Device QA of both create paths (menu-promote
and New Deal). Client-only; needs a rebuild to see on device.

---

## D. Double-tap the QR to redeem manually (scanner-failure fallback)

**Severity: medium. Client part has no locked files and no deploy; a small
server change likely needed and is deploy-gated.**

**STATUS: ✅ CODE DONE 2026-07-25, ⏳ SERVER NOT DEPLOYED.** Uncommitted.
The 14s wait was real (`MIN_MS = 14_000`); without the server change a
double-tap confirm would have sat on a 14-second spinner. Rather than deleting
it, `complete-visual-redeem` gained an opt-in `manual: true` that skips the
pacing wait **and nothing else** — a source contract pins that the flag is
referenced exactly twice. That keeps the deploy strictly additive.
`lib/functions.ts` is poster-locked, so the flag is sent from a new unlocked
`lib/manual-redeem.ts` instead of amending the wrapper there.
Shipped on **both** QR surfaces per Dan: shared `hooks/use-manual-qr-redeem.ts`
so gesture, copy, and error handling can't drift. `claimId`/`dealId`/`businessId`
threaded into `QrModal` from all three call sites (feed, deal page, wallet).
No time gating anywhere; the single guardrail is the branded confirm.
Validation: `typecheck`, `typecheck:functions` exit 0, `lint` 0,
`vitest` 2031/2031 (3 new contracts), `check:i18n-keys` PASS.
**Until `complete-visual-redeem` is deployed the double-tap will fail with
"Redemption window has not finished yet" — this needs the deploy to work at
all.** Device QA owed after deploy.

### Where things stand

Backend already exists and is already hardened: `complete-visual-redeem`
writes via service role (index.ts:188), stamps `redeemed_at_location_id`
(:195), inserts a `redemptions` audit row (:231), sets
`redeem_method='visual'` — which `app/(tabs)/wallet.tsx:853-858` already keys
receipt copy off. `lib/functions.ts:355-405` still exports
`beginVisualRedeem` / `completeVisualRedeem` / `cancelVisualRedeem`. The app
just stopped calling them: `onSlideConfirmed` (`wallet.tsx:639-672`) only
reveals the pass (`method: "staff_scan_qr"`), so a failed scan is a dead end.

Doc drift to fix while here: `findings/02-deal-claims-self-redeem.md` and
`findings/06-visual-redeem-honor-system.md` both still say "Status: NOT
STARTED", but the Option-1 hardening (location bind + audit row) is
implemented and client writes were locked down by migration
`20260804121000_lock_down_deal_claims_client_writes.sql`. Mark both resolved,
and record Dan's 2026-07-25 accepted-risk decision in 06.

### Steps

- [ ] **Read `supabase/functions/complete-visual-redeem/index.ts` and
  `begin-visual-redeem` first.** Finding 06 says completion enforces a
  ~14s–120s elapsed window after `begin` — a pacing leftover from the old
  countdown UX ("a UX pacing device, not a fraud control", finding 06:83-84).
  Confirm the actual numbers.
- [ ] **Server: remove the wait for explicit manual completion.** Dan wants no
  timers; a 14 s spinner after double-tap-confirm is exactly that. Smallest
  change wins — e.g. drop the minimum-elapsed check (keep the max-window /
  auto-finalize logic intact). Not a locked file. **Deploy is Dan-gated** —
  batch the approval with B's deploys.
- [ ] **Client — pass modal** (`components/wallet-visual-pass.tsx`):
  - Persistent hint under the QR, always visible, short: EN
    "Tap the QR twice to redeem" (+ hand-written ES/KO).
  - Double-tap detection on the QR wrapper (lastTap ref, ~300 ms window; RN
    has no built-in double-tap).
  - On double-tap: **branded confirm** via `useBrandedConfirm` (project
    convention — never `Alert.alert`): title "Redeem now?", body "This marks
    the deal as used and can't be undone.", confirm "Redeem". This is the
    accidental-double-tap guardrail.
  - On confirm: `beginVisualRedeem(claimId)` → `completeVisualRedeem(claimId)`
    (if `claim_status === 'redeeming'` already, skip begin). Errors through
    `translateKnownApiMessage`.
  - On success: reuse the existing redeemed watch/toast + `loadClaims()`
    refresh in `wallet.tsx` (the 3 s redeemed-watch already exists).
  - Accessibility: the double-tap needs an equivalent — add an
    `accessibilityActions` "activate → redeem" on the QR wrapper.
- [ ] **Second QR surface check:** customers also show the post-claim
  `QrModal` (used from feed/deal/wallet). If it shares the QR block with the
  pass modal, the hint + double-tap land there automatically; if not, ship the
  pass modal first and ask Dan (one line) whether QrModal should get it too.
- [ ] Analytics: `redeem_started` context `method: "manual_double_tap"`; emit
  the completion event the QR path emits.
- [ ] Fix `findings/02` + `findings/06` status lines; add the accepted-risk
  note to 06.

### Files
`components/wallet-visual-pass.tsx`, `app/(tabs)/wallet.tsx`,
`lib/i18n/locales/{en,es,ko}.json`, likely
`supabase/functions/complete-visual-redeem/index.ts` (+ its tests),
`findings/02-…md`, `findings/06-…md`. No locked files.

### Validation / gates
`npm run typecheck`, `npm run lint`, `npm test`,
`npm run typecheck:functions` if the fn changed. S10 QA: claim → open pass →
double-tap → confirm → claim lands in Ended as redeemed with visual receipt
copy; verify a `redemptions` row exists. **HARD GATE:** deploying
`complete-visual-redeem`.

---

## E. Google Wallet pass has no route to manual redemption

**Severity: medium. Depends on D. Deploy is Dan-gated.**

**STATUS: ✅ CODE DONE 2026-07-25, ⏳ NOT DEPLOYED, ⚠️ ONE UNVERIFIED ASSUMPTION.**
Uncommitted.
- The planned **spike was not run** — it needs a real S10 with a re-issued pass,
  which requires the (gated) deploy first. So the exact `appLinkData` shape
  Google accepts is still unverified. Everything else here is code-verified.
- Chose `appLinkData` over a new verified https App Link: no `app.json` intent
  filter, no website route, no assetlinks change, no new build config —
  strictly additive to the pass JSON.
- Deep link is `twofer://wallet?pass=1` with **no identifier**. A customer holds
  at most one active claim (enforced in `claim-deal`) and the pass is derived
  from that same claim, so it's unambiguous — and no claim id or redemption
  short code lands in a copyable URI. `twofer` is already a registered scheme.
- `linksModuleData` is unchanged (still https + mailto only), so the marketing
  link still serves anyone without the app installed.
- **De-risked the unverified field:** `upsertGoogleWalletObject` now retries the
  write once without `appLinkData` on any 4xx. If Google rejects the shape, the
  card still updates and we lose only the button — instead of silently freezing
  every pass. A test asserts the object stays complete once the key is removed.
Validation: `typecheck`, `typecheck:functions` exit 0, `lint` 0,
`vitest` 2037/2037 (6 new wallet-pass tests), `check:i18n-keys` PASS.
After deploy, verify on the S10: re-issue a pass, confirm the button renders and
lands on the wallet with the pass sheet open; check function logs for the
"retrying without it" line, which would mean the shape needs fixing.

### Root cause

The pass (`supabase/functions/_shared/wallet-pass-content.ts`) carries the
short-code barcode plus exactly two links (:281-282): "Open Twofer" →
`https://twoferapp.com` (the marketing site, :256) and support mailto. No
link opens the app, let alone the claim. And `app/(tabs)/wallet.tsx` reads no
route params, so no per-claim deep link exists at all. Note: once D ships,
opening the app by hand already works as a fallback — E makes it one tap from
the pass.

### Steps

- [ ] **Spike first (the one open technical question):** Google Wallet
  `linksModuleData` is documented for http/https/tel/mailto; custom schemes
  are unreliable. Test on a real S10 pass which mechanism actually opens the
  app: (a) an `https://www.twoferapp.com/...` URL in the already-verified App
  Link space (`app.json:224-234`, needs a website route), or (b) the
  pass-object `appLinkData` field, purpose-built for this. Prefer (b) if it
  renders.
- [ ] Wallet screen accepts a claim param (e.g. `/wallet?claim=<id>`) and
  opens that claim's pass modal on mount.
- [ ] Point the pass link at the claim; relabel "Redeem manually" (short,
  localized).
- [ ] Apple pass is parked — Google-only for now; mirror when Apple ships.

### Files
`supabase/functions/_shared/wallet-pass-content.ts` (+ its two source tests),
`app/(tabs)/wallet.tsx`, possibly `website/` + `app.json` (App Links).

### Validation / gates
`npm run typecheck`, `npm run typecheck:functions`, `npm test`. S10 QA via a
re-issued pass. **HARD GATE:** deploying the wallet-pass functions.

---

## Order of work

1. **A** — no approvals, no deploy, highest customer impact.
2. **B client half** (deal-detail repeat gate) + **D client half** (double-tap
   UI) — no approvals needed, both device-testable locally.
3. **C** — after Dan's locked-file approval.
4. **Server deploys for B + D in one approval conversation** with Dan.
5. **E** — after D, starting with the appLinkData spike.

## Approvals needed from Dan (everything else is decided — see decision log)

- [ ] C: edit `app/create/ai.tsx` (remove `fromMenuOffer` auto-scroll) — locked file
- [ ] C: edit `lib/create-ai-ux-source.test.ts` only if an assertion breaks — locked file
- [ ] Deploy batch: `send-deal-push`, `weekly-deal-digest` (B) and
      `complete-visual-redeem` (D, if the min-wait removal is needed) — hard gate
- [ ] E: deploy wallet-pass functions to re-issue passes — hard gate
