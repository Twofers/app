# Twofer Card (Wallet Pass) — go-live closure runbook

**Date:** 2026-07-23
**Context:** The app is now live on both the App Store (id 6765769303) and Google Play (`com.unvmex2.twoforone`). The "Add to Wallet" buttons shipped **enabled** — the client flag `EXPO_PUBLIC_ENABLE_NATIVE_WALLET_PASS` is `"true"` in the `production`, `preview`, and `dev-client-apk` profiles, and both stores built after the flag flip (`7232705a`). The feature was **never fully verified in production** before shipping. This runbook closes the two remaining gaps.

Design/architecture reference: [`native-wallet-pass-plan.md`](native-wallet-pass-plan.md). This doc is the execution checklist only.

---

## 0. Resolved since the 2026-07-11/12 build (no action needed)

- ✅ **Official badge artwork.** iOS uses Apple's native system button (`modules/twofer-passkit` → `PKAddPassButton`); Android uses the official Google Wallet badge SVG (`assets/google-wallet/`). No custom "black-pill" anywhere.
- ✅ **Server kill switch** `NATIVE_WALLET_PASS_ENABLED=true` set on prod 2026-07-12.
- ✅ **Lifecycle functions** (claim/redeem/release/etc.) redeployed — all 73 functions match local.
- ✅ **`business-logos` RLS** hardened (owner-scoped write policy applied).

---

## 1. What a real user hits today (the live behavior)

Traced through `wallet-pass-issue` + `add-to-wallet-button.tsx`:

| Platform | Button | On tap | Verdict |
|---|---|---|---|
| **Android (Google)** | Visible (flag on) | Server returns a real `pay.google.com/gp/v/save/…` link → opens Google's save page. Issuer `3388000000023157747` was granted **publishing access 2026-07-23**, so passes now save without `[TEST ONLY]` for any Google Wallet user. | ✅ Unblocked — do the final confirm with a non-test account (§2). |
| **iOS (Apple)** | Visible (flag on) | Server returns a signed `.pkpass` → native PassKit "Add" sheet. Apple has **no demo gate**, so this likely works — but the on-device add/update path has **never been run on a real iPhone**. | ⚠️ Probably works; unverified (§3). |

**The one thing that flips all of this:** if `NATIVE_WALLET_PASS_ENABLED` is ever OFF, both buttons stay visible but every tap shows "Couldn't add your Twofer Card." (It was set true 07-12, so assume ON.)

**No remote lever hides the buttons** — the client flag is baked in at build time. Hiding them = a new build + resubmit on both stores. So the pragmatic path is to close the gaps, not hide.

### Two 2-minute confirmations (Dan)
1. **Google issuer state** — Google Pay & Wallet Console → API → issuer `3388000000023157747` → is it "Demo/Test" or "Published/Live"?
2. **Apple, on your iPhone** — install the live App Store build, claim a deal, tap **Add to Apple Wallet**. Does the pass add and show the deal?

---

## 2. Google Wallet — request publishing access (unblocks Android)

**Who:** Dan (business account owner). **ETA:** Google reviews the issuer after you submit; no published SLA, typically a few business days — start now. Steps verified against Google's official [Requesting publishing access](https://developers.google.com/wallet/generic/test-and-go-live/request-publishing-access) doc, 2026-07-23.

**Twofer facts to have on hand:** issuer ID `3388000000023157747` ("Twofer"); pass class `3388000000023157747.twofer-card`; support email `support@twoferapp.com`; site `https://twoferapp.com`.

### Prerequisites (must be green before the request button appears)
- [ ] **Business Profile complete.** Google Pay & Wallet Console (https://pay.google.com/business/console) → **"Business Profile"** in the left nav. Fill in business info **and** set up or select a **Google payments profile** (business identity / tax details — this is the sub-step most likely to take time if you don't already have one). Add the business logo, support email, and website.
- [x] **At least one Passes Class exists.** Already done — `3388000000023157747.twofer-card` was created by `scripts/wallet-google-class-setup.mjs`. Nothing to do.
- [x] **Pass screenshots.** No longer required for production access (Google dropped this).

### Request publishing access — ✅ APPROVED 2026-07-23 (Google emailed: publishing access granted)
- [x] In the console, click **"Google Wallet API"** to open the Google Wallet console.
- [x] Find the box labeled **"Get publishing access"** and click the **"Request publishing access"** button.
- [x] Submit the request. *(Description corrected before submit to match the real pass — deal card, not a member/tier/ID card.)* Google will review the Issuer account and notify you of the outcome.

### Unblock your own QA immediately (don't wait for approval)
- [ ] While in **Demo Mode**, only accounts with the **Admin** or **Developer** role on the issuer — or accounts you add as **test accounts** — can save passes; everyone else gets blocked / `[TEST ONLY]`. In the Google Wallet console (near the "Get publishing access" box / account settings), add **your own Google account** (and any tester's email) as a test account. Then your "Add to Google Wallet" in the live app works right now. *(If you can't find the test-account field, tell me and I'll pull the exact location.)*

### After approval — ✅ granted 2026-07-23
- [x] Google approved publishing access (email from `no-reply-support@google.com`). The **`[TEST ONLY]`** annotation should now be removed and any Google Wallet user can save the pass.
- [x] **No code or deploy change on our side** — the same `save_url` from `wallet-pass-issue` now produces un-watermarked passes. We already use Google's approved **Web API save-link (JWT)** flow + the official badge, so there is nothing to re-implement (the email's "Android SDK" step is an alternative we don't need).
- [ ] **Final confirm:** add the card with a Google account that is *not* an admin/developer/test account on the issuer, and verify the `[TEST ONLY]` banner is gone. That's the last proof Android is fully live for real users.

Nothing else on our side changes: the service account, the `twofer-card` class, and the issue function are already live and verified.

---

## 3. Apple Wallet — on-device QA (verify the shipped iOS flow)

**Who:** Dan, on a real iPhone (the live App Store build is fine). **Needs:** a second device running a merchant/staff build to scan the pass QR (or use the short-code / visual-redeem path).

**⏸ PARKED 2026-07-23 — no iPhone available.** Can't run on Windows (no iOS build/PassKit locally); needs a real iPhone via the live App Store build or TestFlight. The Apple button is live and server-verified, so it very likely works — the on-device path is just *unconfirmed*. Resume this the moment an iPhone is in hand.

### Pre-device code review of the Apple client path (2026-07-23, read-only)

No smoking-gun bug; the client is well-built and the dangerous parts are handled correctly (binary fetch bypasses the invoke text-decode corruption, clean platform split, no raw error leakage, auto-localized system button, main-queue presentation, PKPass parse guarded). Ranked things to watch on-device:

1. **[verify first — highest impact] Native module linking.** `modules/twofer-passkit/src/index.tsx` calls `requireNativeModule("TwoferPassKit")` + `requireNativeViewManager("TwoferPassKit")` at **import time**, and that chain is statically imported by `add-to-wallet-button.tsx` ← `qr-modal.tsx`/Wallet tab. On iOS, if the local module didn't autolink into the binary, these **throw at import → the QR modal and Wallet tab fail to render for all iOS users**, not just wallet users. Config/podspec look correct and the build shipped, so it probably linked — but it's never been confirmed. → **First device check:** open the Wallet tab and trigger the QR modal (claim a deal); a redbox/crash naming `TwoferPassKit` = it didn't link.
2. **[verify — likely fine] No `PKAddPassesViewControllerDelegate`.** `TwoferPassKitModule.swift` presents the add sheet with no delegate. Delegate-less presentation normally self-dismisses on Add/Cancel, but this is the documented spot to control dismissal. → Confirm the sheet closes on **both** Add and Cancel. If it ever hangs, the fix is a one-line delegate that calls `dismiss` in `addPassesViewControllerDidFinish` (ask agent).
3. **[by design] "presented" ≠ "added".** `presentPassAsync` returns as soon as the sheet appears; iOS never records an added-flag, so the Apple button always stays visible (intentional — PassKit owns the decision). Spinner clears when the sheet opens, which is correct.
4. **[minor] Strict base64 decode.** Swift `Data(base64Encoded:)` has no `.ignoreUnknownCharacters`; current input is clean so it's fine. If a valid pass ever returns `invalid_pass`, add that option.
5. **[cosmetic] Button contrast.** `PKAddPassButton(.black)` on the dark card (`#11181C`) — eyeball on device; `.blackOutline` may read better. Sanity-check the 220×48 sizing.

The server-side `.pkpass` was signature-verified; what's unproven is the **on-device add + auto-update (APNs)** path. Test in this order:

- [ ] **Add before claiming.** Wallet tab → Add to Apple Wallet → pass adds showing **"No active deal" / "Open Twofer to grab today's deal"**, penguin logo, no QR.
- [ ] **Claim a deal.** Within a few seconds the card auto-updates (APNs push) to: deal title, business name, redeem-by time, and a QR. ← *the key auto-update test; if the card doesn't change on its own, APNs delivery is the thing to debug.*
- [ ] **QR scans.** Point a merchant/staff device at the pass QR → it redeems (payload is `twofer://redeem/sc/<SHORT_CODE>`).
- [ ] **Redeemed state.** Right after the scan, the card flips to **"Redeemed 🎉"** + "See you next time.", no QR, within seconds.
- [ ] **Release / expire.** Release the claim or let it expire → card returns to **"No active deal"**.
- [ ] **Short-code fallback.** The formatted short code shows under the QR (barcode altText) so staff can type it if a scan fails.
- [ ] **Locale.** Set the phone to Spanish, then Korean; add a fresh pass; confirm content localizes.
- [ ] *(optional)* **Lock-screen relevance.** Near the redeem-by time / business location, the pass surfaces on the lock screen (Apple-only nicety).

If any auto-update step fails, the likely culprit is APNs delivery to a real device (the one thing the simulated tests couldn't cover) — capture the behavior and I'll trace `wallet-pass-webservice` + `apple-apns.ts`.

---

## 4. Open decision for Dan

The Android button is effectively broken for real users until §2 lands. Options:
- **(a) Race the approval** — leave the buttons live, close §2 (days) + §3 (now). Simplest; a few days of `[TEST ONLY]` Android passes in the meantime.
- **(b) Hide until ready** — flip the client flag off and ship a new build to both stores (rebuild + resubmit; also pulls the iOS button). Slower, cleaner storefront.

Recommendation: **(a)**, plus add yourself to the Google test-account allowlist today so your own card works immediately.
