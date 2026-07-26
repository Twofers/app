# Handoff: finishing the five claim/notify/format/redeem fixes

Written 2026-07-25 end of session, for pickup 2026-07-26.
Companion doc: `docs/plans/claim-notify-format-redeem-fixes-plan-2026-07-25.md`
(the per-item tracker — root causes, file:line, and what each fix does).

---

## Where things stand right now

**All five fixes are written, tested and committed. Nothing has shipped.**

- Branch `qa/poster-ad-quality`, **8 commits ahead, NOT pushed**.
- **No edge function deployed.** Production is running the old code.
- **No app rebuild.** No real user sees any of this yet.
- Baseline green as of the last commit: `typecheck`, `typecheck:functions` exit 0,
  `lint` 0 problems, `vitest` **2037/2037**, `check:i18n-keys` PASS,
  `gate:ai-poster-lock` 30/30, `gate:ai-ad` PASS.
- **Only item C is device-verified.**

| Item | What it fixes | Code | Deploy needed | Device QA |
| --- | --- | --- | --- | --- |
| A | "Something went wrong" on a second claim | ✅ | none | ❌ needs shopper account |
| B | Pushes to repeat-blocked customers | ✅ | 2 fns | ❌ after deploy |
| C | Menu-promote forced poster style | ✅ | none | ✅ **passed on S10** |
| D | Double-tap the QR to redeem manually | ✅ | 1 fn | ❌ after deploy |
| E | Google Wallet pass had no route into the app | ✅ | 8 fns | ❌ after deploy |

The commits, newest first:

```
d6c8a594  Record item C device QA on the S10
0aabe0e9  Add the tracker for the five fixes
fa6139b2  Give the Google Wallet pass a route into the app        (E)
872a6e63  Add double-tap-the-QR manual redemption                 (D)
8e41f9de  Let merchants see the ad-format choice from the menu    (C)
5a7e0796  Stop pushing new deals to blocked customers             (B)
a289df70  Offer a way out of the claim conflict + locales         (A)
f9619555  Say why a second claim was blocked                      (A)
```

---

## Decisions already made — do not reopen

- **D, redeem-at-home is an ACCEPTED RISK** (Dan, 2026-07-25). A customer can
  burn a claim away from the counter; it only forfeits their own reward. No
  staff-proof mechanism is wanted. Recorded in `findings/06`.
- **D, no time gating of any kind.** No delayed reveal, no countdown. The hint
  ("Tap the QR twice to redeem") is always visible. The branded confirm exists
  only to stop a fumbled double-tap.
- **B fails open.** A lookup error sends to everyone (today's behaviour) rather
  than silencing a release.
- **C: `DEFAULT_CREATIVE_FORMAT` stays `poster_v1`.** Poster is still the default
  everywhere; the fix only stopped hiding the toggle. The locked-file edit was
  approved by name and the lock hash + `Prior ref:` chain are already updated.
- **D on both QR surfaces** (the Use Deal pass and the post-claim QR modal).

---

## Task list, in the order I'd do it

### T1 — Push the branch  ⛔ GATED

Nothing else needs this, but it gets the work off one machine.

```bash
git push -u origin qa/poster-ad-quality
```

CI will run `check:i18n-keys` and `gate:release-state` on top of the local
baseline. `gate:release-state` may complain that generated state is stale
because B and E add a new shared module and change function sources — if it
does, run `npm run release:state` and commit the result.

---

### T2 — Device QA for item A  ← cheapest remaining win, no deploy

**This is the bug Dan reported first and it is fully testable today.** It needs
the QA shopper account, which means signing out of the business account on the
S10 and writing one real claim to production (releasable afterwards from the
wallet). Dan declined this on 2026-07-25 only because he wanted to stop for the
night, not on principle — confirm before doing it.

Steps once signed in as `TWOFER_QA_SHOPPER_EMAIL`:

1. Claim any live deal.
2. Go to a **different** deal and press Claim.
3. **Expect:** *"You can only claim one deal at a time. Redeem or release the
   deal in your wallet first."* plus a **"Go to my wallet"** link under it.
   **Fail condition:** "Something went wrong. Try again."
4. Repeat from the home feed (the banner there previously offered a
   pull-to-refresh retry that could not help).
5. Optional: switch the app to Spanish and repeat — the copy is hand-written in
   es/ko and should not fall back to English.

Then release the claim from the wallet to leave prod tidy.

---

### T3 — Deploy B  ⛔ GATED — low risk

Two functions. The new shared module is imported only by these two.

```bash
npx supabase functions deploy send-deal-push
```
```bash
npx supabase functions deploy weekly-deal-digest
```

**Why it's low risk:** every lookup failure fails open to today's behaviour. The
columns it reads are already read by live code, so they exist.

**What changes for users:** customers a business has blocked from claiming again
stop getting that business's "new deal" pushes.

**How to verify:** invoke the digest dry-run and read `repeat_restricted_users`
in the response; on a real release, `deal_push_events.metadata.repeat_blocked`
records how many recipients were filtered.

---

### T4 — Deploy D  ⛔ GATED — very low risk, do before any rebuild

One function, one optional boolean, strictly additive.

```bash
npx supabase functions deploy complete-visual-redeem
```

**Nothing in the shipped app calls this function today**, so deploying it alone
changes nothing for anyone.

⚠️ **Ordering matters.** If the app rebuild ships *before* this deploy, the
double-tap fails visibly with "Please wait for the pass to finish." Deploy this
first, or in the same window.

**Device QA after deploy** (needs the shopper account and one claim):
open the wallet → Use deal → double-tap the QR → confirm → the claim should land
in **Ended** as redeemed with the visual-method receipt copy. Then check a
`redemptions` audit row exists for it.

---

### T5 — Decide on E  ⛔ GATED — think before running

**This is the only deploy that touches critical paths.**
`_shared/wallet-pass-sync.ts` and `_shared/wallet-pass-content.ts` are bundled
into **8 functions**, including **`claim-deal` and `redeem-token`**.

```bash
npx supabase functions deploy claim-deal
npx supabase functions deploy complete-visual-redeem
npx supabase functions deploy finalize-stale-redeems
npx supabase functions deploy redeem-token
npx supabase functions deploy release-claim
npx supabase functions deploy staff-redemption
npx supabase functions deploy wallet-pass-issue
npx supabase functions deploy wallet-pass-webservice
```

**It has to be all 8 or none.** Every one of them rewrites the whole Google
Wallet object. Deploy only some and the next claim overwrites the object without
the app link, so the button appears and then vanishes.

Two checks first:

- Is `NATIVE_WALLET_PASS_ENABLED` actually `true` in prod? If not, E does nothing
  (harmless, but there is no reason to touch `claim-deal` for it).
- The `appLinkData` shape is the **one unverified assumption in this whole
  batch** — it could not be checked without a re-issued pass on a device. It is
  de-risked: `upsertGoogleWalletObject` retries the write once without
  `appLinkData` on any 4xx, so a wrong shape costs the button, not pass updates.
  **After deploying, grep the function logs for `retrying without it`.** If it
  appears, the shape needs fixing but nothing is broken.

**Recommendation:** hold E until `claim-deal`/`redeem-token` are being deployed
anyway for another reason. A wallet-pass button is not worth its own deploy
window on the money paths.

---

### T6 — App rebuild  ⛔ GATED — the big one

All five items need a rebuild to reach real users; A and C live entirely in the
client. This is a larger change than any of the deploys and none of A, B(client),
D or E has been through a full release check.

Follow `docs/beta-release-checklist.md`. Remember `expo.version` must be bumped
by hand per store release (`autoIncrement` only moves the build number) followed
by `npm run release:state` — see the EAS version memory.

---

### T7 — Optional: a DB test for B's queries

B's *logic* is unit-tested, but the *queries* have never run against a real
schema. `scripts/db-tests/` runs against the guarded test project
(`assert-test-db.mjs` is an allowlist that fails closed).

A `2j-repeat-claim-audience.mjs` suite would prove `businesses
.repeat_claim_policy_type` and the `deal_claims` redemption lookup behave as
assumed — catching a wrong query *before* the deploy rather than after. Cheap,
no build, no production contact.

---

## Open items unrelated to shipping

1. **The dev APK talks to production.** `.env.development.local` and
   `docs/dev/AI_DEAL_STUDIO_SUPABASE_DEV_SETUP.md` both target
   `kvod…ovia` (prod), while `CLAUDE.md` says *"dev builds must use a separate
   Supabase development project, not production."* One of the two is wrong and
   should be reconciled. Right now "dev APK" means a differently-branded app on
   live data.

2. **`deno.lock` drift.** Running `npm run typecheck:functions` rewrites it to
   add `npm:expo-build-properties` — a dependency already in `package.json`,
   unrelated to this work. I reverted it each time to keep diffs scoped. Worth a
   standalone one-line commit.

3. **The test project is not a staging environment.** It has 10 edge functions;
   production has 79, and it is missing every function we changed. Making it a
   real staging target means deploying ~6 more functions plus seeding businesses,
   deals, favorites, push tokens and redemption history. Worth doing for launch
   confidence someday; it was not worth doing to unblock these fixes.

---

## Reusable: loading new JS onto the S10 without a rebuild

All the client changes here are pure JS, so the installed dev client picks them
up from Metro — no rebuild needed. This worked on 2026-07-25:

```bash
adb reverse tcp:8081 tcp:8081
```
```bash
EXPO_NO_METRO_LAZY=1 npx expo start --dev-client --port 8081 --clear
```
```bash
adb shell am start -n com.unvmex2.twoforone.dev/.MainActivity -a android.intent.action.VIEW -d "twofer://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
```

Notes:
- Both `com.unvmex2.twoforone` (v1.0.0) and `com.unvmex2.twoforone.dev` (v1.0.1)
  are installed and are DEBUGGABLE dev clients. `.dev` matches current code.
- Check for a stale Metro on 8081 first — there was a 14-hour-old one holding the
  port, which is a good way to get confusing half-old bundles.
- Screenshots: `adb shell screencap -p /sdcard/x.png` then `adb pull`. The
  `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"` prefix is required on this
  machine. They are **not** black on this device.
- Kill Metro when done — `TaskStop` on the wrapper is not enough, the node
  process survives and keeps holding 8081.
