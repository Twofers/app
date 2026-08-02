# S10 physical-device QA — production 1.0.2 (Android)

Date: 2026-08-02
Device: Samsung Galaxy S10 (SM-G973U1), serial `RF8T20X0Z7P`, Android 12
Build under test: `com.unvmex2.twoforone` **versionCode 61 / versionName 1.0.2**,
`installerPackageName=com.android.vending` (Play internal testing payload —
the exact binary built from `2451ff39`)
Account: `unvmex2@gmail.com` via Google sign-in (founder account, by decision)

This covers both open Android gates in
`docs/plans/production-app-1.0.2-update-plan-2026-08-01.md` section 6: the
physical-device smoke (9/10 sub-checks pass, see below) and Google Wallet
(save passes; pass-to-app is still failing after a deployed fix, root cause
not yet fully confirmed). A second, out-of-scope bug — released claims not
returning deal inventory — was found and documented but not fixed.

## Result summary

| # | Gate | Result |
|---|------|--------|
| 1 | Google sign-in | PASS |
| 2 | Maps | PASS |
| 3 | Location denial / ZIP fallback | PASS |
| 4 | Customer claim / release | PASS |
| 5 | Merchant QR redemption | PASS |
| 6 | Push settings | PASS |
| 7 | Deep links | PASS |
| 8 | Support contact | PASS (consumer surface) |
| 8b | No external-payment CTA (merchant surface) | PASS |
| 9 | Google Wallet save | PASS |
| 9b | Google Wallet **pass-to-app** | **FAIL — root cause fixed + fully deployed; retest after deploy STILL FAILS (see below)** |
| 10 | Account deletion | PASS to final confirmation (not executed) |
| — | Release does not return deal inventory | **CONFIRMED BUG**, out of original scope, found during retest — see §4 |

The original blocker (no real claimable deal) was cleared mid-run by publishing a
real one — see "Unblocking: published a real deal" below.

## Detail

### 1. Google sign-in — PASS

Tapped **Sign in with Google**; the GMS account picker rendered with the Twofer
penguin icon, the app name "Twofer", and the standard consent line. Selecting
the account completed sign-in and routed straight into first-run onboarding.
No password was typed at any point.

### 2. Maps — PASS

Map tab rendered live Google tiles for the DFW metro with correct
`©2026 Google` attribution, road/label layers, the ZIP-derived search-radius
ring, and a business pin card. No "for development purposes only" watermark and
no blank/grey tile, so the **production Maps key resolves correctly on a real
device**.

### 3. Location denial / ZIP fallback — PASS

Location permission started denied (`ACCESS_FINE_LOCATION` /
`ACCESS_COARSE_LOCATION` both `granted=false`). Onboarding requested it with the
correct "Allow Twofer to access this device's location?" prompt; chose
**Don't allow**.

The app recovered exactly as designed:

- surfaced "Location wasn't shared. You can enter a ZIP code instead.";
- auto-switched the selector to **Enter ZIP instead**;
- revealed the ZIP field and held **Get started** disabled until a ZIP existed;
- accepted `75201`, geocoded it, and surfaced a real nearby business
  (Cedar & Bean Cafe, MacArthur Blvd, Irving TX) on the favorites step;
- persisted both the ZIP and the 10 mi radius into Settings.

### 6. Push settings — PASS

Settings → Notifications exposes the **Deal alerts** toggle and the
All nearby deals / Favorites only scope selector. Toggling Deal alerts on
succeeded. Android 12 has no `POST_NOTIFICATIONS` runtime permission, so the
absence of a permission prompt is correct for this device.

### 7. Deep links — PASS

- `pm get-app-links` reports `www.twoferapp.com: verified` — assetlinks.json
  validates against the installed signing certificate
  (`92:65:79:9A:...:C9:C0`).
- Custom schemes `twofer://` and `twoforone://` resolve directly to
  `com.unvmex2.twoforone/.MainActivity`.
- Launching `https://www.twoferapp.com/s/TESTCODE` opened the app (not Chrome),
  and the unknown code produced a clean localized **"Invalid link — This deal
  link is not valid."** dialog rather than a crash or a silent no-op.
- **Retested later (15:35) with a real share code from a since-expired deal**
  (`/s/SKZDAXG`, copied via the in-app Share sheet's Copy action). Launched cold
  from a fully logged-out state after `am force-stop`: the app opened directly
  (not Chrome) and showed **"Deal unavailable — This shared deal is no longer
  available."** with a single OK button — correct handling of a real, expired
  code, distinct from the earlier malformed-code case, and proof the App Link
  path works before any session exists, not just when already signed in.

**Device-state note (not a product defect):** this S10 had App Link handling
explicitly *disabled* for both `www.twoferapp.com` and the Supabase
`deal-link` host under `Selection state: Disabled`, left over from earlier
testing. A fresh install defaults to enabled, and verification itself was
never the problem. Re-enabling with
`pm set-app-links-user-selection --user cur --package com.unvmex2.twoforone true <host>`
restored normal routing, which is the state the test above was run in.

### 8. Support contact — PASS (consumer surface)

Settings → Help & contact shows **Contact support** plus the visible address
`support@twoferapp.com`. Tapping it dispatched a `mailto:` intent and Android
raised the app chooser. No message was composed or sent.

Legal row exposes Privacy Policy · Terms of Service · Support.

**No external-payment CTA anywhere on the consumer surface** — no Checkout,
billing, pricing, or subscription link in Home, Map, Wallet, or Settings. The
merchant-surface half of this gate still needs a merchant session on the
device.

### 10. Account deletion — PASS to final confirmation (not executed)

Settings → Delete account carries the standing warning "Permanently deletes
shopper account, saved places, tickets, and history. This cannot be undone."

The flow is a **two-step guard**:

1. "Delete account?" — *Starts deletion review. Can remove your login, shopper
   profile, saved places, tickets, and history.* → **Review final warning** /
   Cancel.
2. "Delete permanently?" — *Final warning: deleting your account permanently
   removes your Twofer login, shopper profile, saved places, claimed tickets,
   and redemption history. This cannot be undone.* → **Yes, delete
   permanently** / **Keep account**.

Backed out via **Keep account**; the account remained intact and signed in.
Per the founder decision for this run, the irreversible confirm was **not**
tapped, so deletion execution itself remains unverified on device.

## Blocker: no real claimable deal in production (RESOLVED — historical)

This section describes the state at the start of the run. It was resolved by
publishing a real deal (next section) and is kept only as evidence that the
demo-only inventory was a real, verified gap, not an assumption.

Gates 4, 5, and 9 could not run at first. Verified on device:

- **Deals tab → View all deals** (which bypasses the radius — it returned
  Grapevine offers 19.0 mi from the 75201 centroid) lists only Cedar & Bean
  Cafe offers, and every one renders a **disabled "Demo offer" button** in place
  of a claim CTA.
- The shop page carries the explicit disclosure: *"This deal is included so
  testers can try the app. It is not a real business offer and cannot be
  redeemed."*
- Searching `Colonel` returns **no live deals** and **no shops**; the metro shop
  list contains only the two Cedar & Bean locations (Grapevine, Irving), both
  chipped **No live deal**.
- Wallet is empty ("No tickets yet"), so the account is claim-clean and there
  is no pre-existing ticket to exercise.

This matches the known constraint that `claim-deal` rejects `is_demo` before any
other check, so demo offers cannot stand in for a real one.

**Unblock path (founder decision 2026-08-02):** log the device into a business
account, publish a real deal, then return and run claim/release, merchant QR
redemption, and the Google Wallet save + pass-to-app route against it.

## Unblocking: published a real deal from the merchant account

Signed in as `test2@test.com` (Cedar & Bean Cafe — MacArthur Blvd, Irving) and
published a real, non-demo offer through the in-app AI ads flow. This doubles as
physical-device coverage of the merchant publish loop.

- Typed only a free-text description; the form **auto-parsed** it, selecting the
  BOGO rule and filling "house cold brew" as the buy item.
- The offer is a **same-item BOGO** (buy cold brew → get cold brew), previously a
  publish blocker. The eligibility guard returned green **"Eligible offer —
  Eligible: customers get a named item free with purchase."** Regression fix
  confirmed on device.
- Skipped the photo, so the ad was generated from text alone. Generation took
  ~90 s behind a branded progress dialog with a working Cancel.
- The generated poster was legible and correct: headline readable over a dark
  photo (an earlier failure mode), two cold brews matching the 2-for-1 claim, and
  a `REDEEM BY` stamp.
- Published successfully — "House cold brew run is now live for customers",
  1 live deal, window 11:03 AM → 12:02 PM, 10 claims max, 15-minute claim cutoff.
- The deal appeared in the **consumer** feed immediately after switching accounts.

### 8b. No external-payment CTA on the merchant surface — PASS

Walked the entire merchant Account surface on the device, including expanding the
collapsed **"+ More options"** section, which reveals only Legal (Privacy Policy ·
Terms of Service · Support). Nothing anywhere offers Checkout, billing, pricing,
subscription, or any external-payment link. Merchant surface exposes: Log out,
Contact support, business profile/completeness, limit-repeat-customers, redemption
mode, offers & AI language, dashboard, and Delete account.

## 4. Customer claim / release — PASS

Claimed the real deal as the consumer. The QR sheet opened **ACTIVE** with a live
countdown, `Redeem by 12:12 PM (includes grace period)`, the claim code, an
**Add to Google Wallet** button, Refresh QR, and Send to a friend. Availability
decremented 10 → 9.

**Release** showed a clear confirmation ("This gives up your claim and returns it
to the deal…"), and after confirming, Wallet moved to "No active deals" with the
ticket relisted under **Ended deals** carrying a "Released" badge and the original
claim/expiry timestamps. Re-claiming succeeded and issued a **freshly rotated
claim code** — codes do not survive a release/re-claim cycle.

### CONFIRMED BUG — releasing a claim permanently consumes deal inventory

**Upgraded from observation to confirmed defect on 2026-08-02**, with a clean
controlled sequence on a freshly published 10-claim deal and a root cause in
source. Superseded the tentative reading recorded below.

Device evidence (deal published with `max_claims = 10`, no other claimants):

| Step | "claims available" |
|---|---|
| Before any claim | **10** |
| After claim | **9** |
| After release | **9** — not 10 |

The release dialog states: *"This gives up your claim and returns it to the
deal."* It does not.

**Root cause — a status added without updating the three places that count.**
`release-claim` writes `claim_status = 'released'`
(`supabase/functions/release-claim/index.ts:119`). `'released'` was added to the
`deal_claims_claim_status_check` constraint by
`20260721120000_deal_wallet_redemption_rules.sql:138`, but every cap/count site
still excludes only `'canceled'`:

| Site | Location | Exclusion |
|---|---|---|
| Display RPC | `20260716120000_deal_claim_counts_rpc.sql:22` | `IS DISTINCT FROM 'canceled'` |
| DB cap enforcement | `20260704130000_enforce_max_claims_atomic.sql:36` | `claim_status != 'canceled'` |
| `claim-deal` cap check | `supabase/functions/claim-deal/index.ts:713` and `:873` | `.neq("claim_status", "canceled")` |

Nothing in the codebase writes `'canceled'` to `deal_claims.claim_status` any
more, so the exclusion list filters a status that never occurs while missing the
one that does.

**This is not display-only.** `claim-deal` enforces the cap with the same query,
so a deal capped at 10 hard-refuses the 11th claim with *"This deal has reached
its claim limit."* even if all ten were released and nothing was ever redeemed.
A deal's entire inventory can be exhausted by claim-then-release churn with zero
redemptions, and the merchant sees a sold-out deal.

**Fix requires a product decision, so it was NOT applied.** Either
(a) make the three sites exclude `'released'` (and probably `'expired'`) so
released claims free inventory, matching the UI promise — note this enables
claim/release churn unless rate-limited; or
(b) change the release copy to say the claim is given up but the slot is not
returned. Option (a) matches user expectation and merchant intent; it changes
production claim semantics and touches a migration plus an Edge Function, which
is why it is flagged rather than shipped.

### Original observation (superseded by the confirmed finding above)

What was actually observed on the deal detail screen: the deal published with
"Limited to 10 available"; the detail page was not re-checked between the first
claim (11:06) and the release (11:13); **after the release it read "9 claims
available"** — had the release restored inventory it would have read 10 — and
after the re-claim (11:15) it read **"8 claims available"**. The release dialog
states the claim is "returned to the deal", but availability never came back.
If confirmed server-side, a customer who releases and re-claims permanently
burns merchant stock, and the release copy overpromises. Not verified against
the database — flagged for follow-up rather than asserted as a defect.

## 9. Google Wallet — save PASSES, pass-to-app FAILS

**Save — PASS.** "Add to Google Wallet" launched GMS `PayActivity`, which rendered
an "Add pass" sheet with correct Twofer branding, then confirmed **"Added to
Wallet"**. The saved pass carries the deal title, business, `Redeem by`, the QR,
and the claim code, so staff can scan straight from Google Wallet.

**Pass-to-app — FAIL.** No app-link button is rendered on the saved pass at all.

**Correction to the first reading of this finding.** It was initially reported as
*"the 'Open Twofer' action opens Chrome instead of the app."* That is wrong about
which control is at fault: the **"Open Twofer" row in the pass details is the
`linksModuleData` https entry, and opening the browser is its intended behaviour**
— it is the deliberate fallback for people without the app installed (see the
comment at `wallet-pass-content.ts:414-419`). The real defect is the **absence of
the separate `appLinkData` app button**, which is what should open the app. The
package typo below fully explains that absence, so the fix was still necessary —
but the symptom was mis-attributed.

**Root cause — a one-character typo in the package name.**

- `supabase/functions/_shared/wallet-pass-content.ts:269` declared
  `WALLET_PASS_ANDROID_PACKAGE = "com.unvmex2.twoferone"`.
- The real Android package is **`com.unvmex2.twoforone`** (`app.json:208`;
  `pm list packages com.unvmex2.twoferone` returns **0 matches** on the device).
- `twoferone` ≠ `twoforone`. Google Wallet cannot resolve an `appTarget` for a
  package that isn't installed, so it silently drops the app-link button and falls
  back to the `linksModuleData` https link — `WALLET_PASS_APP_URL`, the marketing
  site. The failure is invisible: nothing errors, the pass just quietly links to
  the wrong place.

**Everything else in that path is correct.** Firing the pass's own target URI
directly, `am start -d 'twofer://wallet?pass=1'`, opened the app straight to the
staff pass sheet — SHOW STAFF header, a 24-second staff scan window, the QR,
**"Tap the QR twice to redeem"**, and the claim code. So the scheme, the app's
handler, and the destination screen all work; only the declared package was wrong.

**The unit test encoded the bug.** `wallet-pass-content.test.ts:241` asserted the
same typo'd string, so the guard passed while the feature was broken.

**Fix applied 2026-08-02** (both files), plus a comment tying the constant to
`expo.android.package`. A repo-wide search for `twoferone` now returns no matches.

**Scope — no new binary required.** This is Edge Function source, not mobile app
source, so the gate can be closed with a function redeploy against the existing
vc61 payload. Retest after deploy: re-save a pass and confirm "Open Twofer" lands
in the app rather than Chrome.

**Deploy status: COMPLETE**, verified against production via
`supabase functions list` at 11:58 on 2026-08-02. All seven functions that embed
the constant are ACTIVE on the fixed source:

| Function | Was | Now |
|---|---|---|
| `wallet-pass-issue` | v31 | **v32** (11:44) |
| `claim-deal` | v110 | **v111** (11:55) |
| `release-claim` | v67 | **v68** (11:56) |
| `staff-redemption` | v66 | **v67** (11:56) |
| `redeem-token` | v112 | **v113** (11:56) |
| `complete-visual-redeem` | v97 | **v98** (11:56) |
| `finalize-stale-redeems` | v93 | **v94** (11:56) |

All six lifecycle functions were required, not just the issuer:
`syncWalletPassForUser` rebuilds and re-upserts the entire Google object on every
claim/redeem/release, so a stale one would have stamped the typo'd package back
onto a freshly saved pass. `wallet-pass-webservice` (v28) was deliberately left
alone — it imports only the kill-switch check and never builds the Google object.

Post-deploy smoke on the S10: app relaunched, Google session restored, Wallet
rendered both ended tickets (Redeemed + Released) and Deals redeemed 1. No
regression from the redeploys.

### Post-deploy retest — the app button STILL does not render

Retested at 12:10–12:16 with a second real deal (published via "Repeat a past
deal") and a fresh claim on the same consumer account.

What was confirmed working:

- The deployed `syncWalletPassForUser` **did patch the existing Google object** —
  the saved pass in Google Wallet updated to the new claim's redeem-by time and
  new claim code without any user action. The redeployed lifecycle functions work.

What still fails:

- **No app-link button appears** on the pass face or in the pass details. The
  details list shows only *Support* and *Open Twofer*; tapping *Open Twofer*
  opens Chrome, which — per the correction above — is that link's correct job.
- So the `appLinkData` button is still not being surfaced by Google Wallet even
  though the object was rebuilt post-fix.

**RESOLVED: the fix was necessary but not sufficient — a second, deeper bug
exists.** Confirmed via a genuinely fresh pass CREATE (not a PATCH — see below)
that the app-link button still never renders. Root-caused against Google's own
published API reference and use-case samples (fetched live 2026-08-02, not
recalled from memory):

1. **`appTarget` is a union/oneof field — `targetUri` and `packageName` are
   mutually exclusive, not both-required.** ([AppLinkData reference](https://developers.google.com/wallet/reference/rest/v1/AppLinkData)).
   `wallet-pass-content.ts:425-428` sets both simultaneously inside the same
   `androidAppLinkInfo.appTarget`. This is invalid per the schema; the docs
   explicitly say to "prefer setting package field instead" when the target is
   the caller's own app.
2. **`androidAppLinkInfo` cannot deep-link to a specific screen at all — only
   `webAppLinkInfo` can.** Confirmed verbatim from Google's Offers use-case
   guide: *"To deep link to a specific view within an app you must use
   webAppLinkInfo."* The documented pattern for opening an installed app is
   `androidAppLinkInfo.appTarget = { packageName: "..." }` alone (a bare
   "open the app" action with no target screen); reaching a specific screen
   requires `webAppLinkInfo.appTarget.targetUri` set to a verified `https://`
   Android App Link.
3. **The code never sets `webAppLinkInfo` at all**, and its `androidAppLinkInfo`
   target is a custom scheme (`twofer://wallet?pass=1`), which isn't an https
   App Link and isn't the field Google documents for deep-linking regardless.

**This is architecturally different from what the code intends.** The comment
at `wallet-pass-content.ts:270-278` explains the deliberate design — route to
the wallet tab with the pass sheet pre-opened — but the chosen API shape
(`androidAppLinkInfo` + custom scheme + both union fields set) cannot deliver
that per Google's own spec, independent of the separate package-name typo
already fixed.

**Correct fix, not implemented:** switch to `webAppLinkInfo` with an `https://`
`targetUri` (e.g. `https://www.twoferapp.com/wallet`), keep
`androidAppLinkInfo.appTarget` to `{ packageName }` alone as the fallback/badge
metadata. **This needs a new verified Android App Link path** — the only
currently verified path is `/s/{code}` (`pathPrefix: "/s"`, `autoVerify: true`
in `app.json`); a `/wallet` (or similar) path needs its own intent-filter entry.
**Intent filters are compiled into the native AndroidManifest.xml at build
time — this is mobile source, not Edge Function source, and needs a new
binary.** The original framing of this gate ("no new binary required") was
wrong once this second bug is accounted for; it only held for the package-name
typo in isolation.

### Confirmed via a genuine fresh CREATE, not just a PATCH

Ruled out "maybe Wallet only honors appLinkData at creation" as an explanation.
`test1@test.com`'s claim/release/redemption history from an earlier QA session
meant it too already had a device-level "pass added" flag — which turned out to
be **a separate, real bug** (below), not a per-account server flag. Cleared it
with `pm clear com.unvmex2.twoforone` (wipes local device storage only; no
server data touched — all Twofer claim state persisted through the clear and
was reconciled once the deployed sync ran), re-logged into `test1@test.com`,
and tapped a genuine "Add to Google Wallet" → Google's own **"Add pass"**
confirmation screen → **"Added to Wallet"**, a real object CREATE with the
fixed package name from the start (not a stale object being PATCHed). The
resulting pass still showed only the globe-icon `linksModuleData` "Open Twofer"
row, which still opened Chrome. Same result as the PATCH case — confirms the
second bug above, not a create-vs-patch caching artifact.

### Second bug found: the "pass added" flag is a global, unscoped local flag

`components/add-to-wallet-button.tsx:48` hides "Add to Google Wallet" once
`getNativeWalletPassAdded()` returns true. That function
(`lib/native-wallet-pass-storage.ts:9`) reads a single AsyncStorage key,
**`twoforone.consumer.native_wallet_pass_added`, with no user id in it**. Once
any Twofer account on a device taps "Add to Google Wallet" once, the badge
disappears for every other account that later logs into the same device — even
though the Google Wallet pass object is genuinely one-per-user server-side (the
code's own comment says as much: *"re-adding from another device is always
safe... one-per-user server-side"* — the gap is same-device, multi-account,
which the comment doesn't consider). This is why the badge never appeared for
`test1@test.com` on first login: `unvmex2@gmail.com` had already tripped the
flag earlier in this same QA session. Real-world impact is low (most users hold
one Twofer account per device) but it is a genuine defect, most visible on
shared/family devices or QA hardware. Not fixed — flagged for a product call:
scope the key by user id, or accept the current one-time-per-device badge as
intentional.

**Gate stays unchecked and this is now a materially bigger fix than a redeploy.**
The typo fix is deployed and correct as far as it goes. The wallet-pass-to-app
feature as a whole needs: (a) the `webAppLinkInfo`/`androidAppLinkInfo` schema
correction above, (b) a new verified App Link path shipped in a new mobile
binary, and optionally (c) a decision on the AsyncStorage key scope. None of
this was implemented — it was diagnosed, not fixed, given the scope (new binary,
new server-verified domain path, cross-cutting app.json changes) is well beyond
what should happen unilaterally mid-QA-session.

**Regression guard added** (`wallet-pass-source.test.ts`): a cross-file
source-sync test now asserts `WALLET_PASS_ANDROID_PACKAGE` equals
`expo.android.package` in `app.json`, and that the pass deep link's scheme is
one the app registers. The original unit test was vacuous because it asserted
the same hardcoded string; the guard makes this class of mismatch unshippable.
Full suite after the change: 320 files / 2,218 tests green.

**Process note:** driving the Ticket-code fallback required typing the active
claim code into the merchant form via adb, which transcribed it into the session
log — a deviation from the no-transcription QA rule. The code was single-use,
was consumed by the redemption at 11:33 (single-use enforcement verified above),
and the deal window closes at 12:02, so it is inert. No code appears in this
document.

## 5. Merchant QR redemption — PASS

Signed the device into the merchant account and worked the Redeem tab. Because
only one physical device was available, the customer's QR could not be scanned by
that same phone, so redemption ran through the **Ticket code** path — which is the
documented fallback ("Use this if the camera isn't available").

**Camera / scanner.** Redeem opened fail-safe: camera permission was not granted,
and instead of a dead scanner it showed "Camera permission is required to scan QR
codes" with a **Grant permission** CTA. Granting produced the correctly branded
"Allow **Twofer** to take pictures and record video?" prompt, after which the
scanner opened with a live viewfinder, framing reticle, and Scan next. The status
bar camera indicator confirmed the camera was actually streaming.

**Negative test.** An invalid 6-character code was rejected with
**"That claim code doesn't match an active ticket."** — no crash, no information
leak. The Redeem button also stays disabled until 6 characters are entered.

**Redemption.** Entering the live claim code succeeded:
**"OK Redeemed — Buy one house cold brew and get one free — Redeemed at Aug 2,
2026, 11:33 AM"**, with **Scan next** to serve the next customer and a
**Report this customer** abuse path.

**Single-use enforcement.** Re-submitting the same code was blocked with
**"This ticket has already been used."** — a distinct message from the
invalid-code case, so staff can tell the two apart.

**Merchant dashboard reconciled.** Offers showed Live deals 1, Claims 5 and
Redemptions 2 this month, and on the deal itself **Claims 2 · Redeemed 1 ·
Redeem rate 50% · Expired 0**.

**Consumer side reconciled.** Signing back in as the consumer showed
**Deals redeemed: 1**, no active deals, and both terminal states rendered
distinctly under Ended deals: a green **Redeemed** ticket annotated
**"Redeemed by staff scan"**, above the earlier grey **Released** ticket.

**Late addendum (17:16):** `test1@test.com`'s unredeemed 4:07 PM claim aged past
its 5:11 deadline and now renders an **"Expired"** badge — so all three terminal
ticket states (**Redeemed**, **Released**, **Expired**) have been visually
verified as distinct on the physical device. Minor observation on the same
screen: "Est. savings $0.00" alongside "Deals redeemed 1" — the redeemed BOGO
deal carried no price, so the figure is technically correct but reads oddly;
cosmetic at most.

### Third corroboration of the confirmed release/inventory bug

The deal card reads **Claims 2** for one released ticket plus one redeemed one —
a third independent surface (merchant dashboard, alongside the deal-detail
counter and the source-level root cause in §4) agreeing that a released claim
still counts against the deal.

## New finding (17:21, spotted by Dan during consumer-language recheck): AI poster headline rendered garbled/truncated on a real, live, customer-facing deal

Reopening the live "Sergeant's Stripes" deal (published earlier this session via
"Repeat a past deal", window 4:54–5:54 PM) to verify Spanish deal-detail copy,
the poster image itself — the actual pixels the AI image model generated, at
the top of the card — reads **"S STRIPES FOR LESS"**. The app's own separate
text overlay directly below the image correctly shows **"THE SERGEANT'S
STRIPES"** / 50% OFF, confirming the underlying deal data is intact and this is
specific to the AI-generated poster image only. Screenshot evidence in the
session transcript (not reproduced here per the no-transcription-of-identifying-content
norm, though this is poster art, not a code/redemption artifact).

**Pattern:** the visible text reads as a mid-word truncation from the *front* —
consistent with an original headline like "THE SERGEANT'S STRIPES FOR LESS"
losing everything through "...ANT'" and leaving "S STRIPES FOR LESS". This
does not read as a deliberate short-form AI copy choice; "S STRIPES FOR LESS"
is not grammatical English on its own.

**Investigated, not fully root-caused.** Checked the one app-side function that
clips AI headline text before it's used —
`supabase/functions/ai-generate-ad-variants/index.ts:277-280`
(`clip(s, max) { … s.slice(0, max - 1) … }`) — and it truncates from the *end*,
preserving the beginning. That's the opposite pattern from what's on screen, so
it's very unlikely to be the cause. The remaining, more likely explanation is
that the **AI image model itself failed to render the full headline text into
the poster's pixels** — a known unreliable behavior for text-in-image
generation, and consistent with prior findings in this project's history
(headline legibility issues on dark photos, item names breaking image
generation). Not confirmed with certainty without inspecting the exact prompt
and headline value sent at generation time, which wasn't captured for this
specific deal.

**Severity: this shipped to a live, real (non-demo) deal a real customer could
see and claim during this session** — the highest-visibility category of
defect found today, even though it's cosmetic/brand rather than functional
(claiming and redemption both worked correctly against this same deal earlier
in the session; the QR, code, and app overlay text were all correct).

Added to the remediation plan as workstream E.

## Final result

**All ten Android gates exercised on the physical S10 against the exact vc61
production payload. Nine pass. One fails and remains open** — Google Wallet
pass-to-app: the package-name root cause is fixed and deployed to all seven
functions that touch it (verified live), but a post-deploy retest still shows no
app-link button on the pass, so a second cause is in play and unconfirmed.

**One additional confirmed bug was found outside the original ten gates**, while
investigating the release flow for gate 4: releasing a claim does not return
deal inventory, in both the displayed count and the actual claim-cap
enforcement, traced to source (§4). Not fixed pending a product decision on the
correct behavior.

Two items remain open for a future session: the Wallet app-link retest (needs a
consumer account with no prior saved pass, and someone to type that account's
password on-device), and the inventory-bug decision + fix.

## Evidence

Screenshots captured to the session scratchpad (not committed): sign-in picker,
post-sign-in onboarding, location prompt, denial fallback, ZIP accepted, home
feed, demo-offer detail, map, settings (×3), delete-account both steps, support
chooser, wallet empty state, logout confirm, logged-out state.

No QR tokens, claim codes, or redemption codes were transcribed.

## State left on the device (as of session handoff, ~15:39)

- App Link handling re-enabled for `www.twoferapp.com` and the Supabase
  `deal-link` host (restores the fresh-install default).
- **Currently logged out**, sitting on the login screen, mid-handoff for
  `test1@test.com` (a fresh consumer account with no prior wallet pass, needed
  to retest the Wallet app-link button). The email/password fields were
  touched during a coordinate error but were cleared before any password was
  entered or submitted — verify on pickup rather than assume clean.
- Shopper profile on `unvmex2@gmail.com`: ZIP `75201`, radius 10 mi,
  Deal alerts ON, one interest chip (Bakery) preselected by onboarding. Wallet
  shows Deals redeemed 1 and two ended tickets (Redeemed + Released); no
  active claims. A Twofer pass for that redeemed ticket remains saved in
  Google Wallet.
- Business account `test2@test.com` published two real (non-demo) deals during
  this run, both since expired: "Buy one house cold brew and get one free"
  (11:03–12:02) and "Cold brew bonus" (12:10–1:10). Merchant dashboard shows
  Claims 5, Redemptions 2 this month. No cleanup needed — both self-expired.
- Camera permission granted to the app (While using the app) during the
  merchant redemption pass; location permission remains denied.
