# Handoff: finishing the five claim/notify/format/redeem fixes

Written 2026-07-25 end of session, for pickup 2026-07-26.
**Revised 2026-07-26** after a full double-check pass — see "What changed on the
2026-07-26 pass" below. Companion doc:
`docs/plans/claim-notify-format-redeem-fixes-plan-2026-07-25.md`
(the per-item tracker — root causes, file:line, and what each fix does).

---

## Where things stand right now

**All five fixes are written, tested, committed and pushed. Nothing is deployed.**

- Branch `qa/poster-ad-quality`, **pushed and level with `origin`**, CI green on
  HEAD (`35ab4290`). Working tree clean.
- **No edge function deployed.** Production is running the old code.
- **No app rebuild.** No real user sees any of this yet.
- Baseline re-run in full on 2026-07-26, all green:
  `typecheck` 0, `typecheck:functions` 0, `lint` 0 problems,
  `vitest` **2050/2050 across 287 files**, `check:i18n-keys` PASS,
  `gate:ai-poster-lock` 30/30, `gate:release-state` passed.
- **Only item C is device-verified.** The rest cannot be device-tested right now
  — not because of the deploys, but because production has no claimable deal.
  See "The device-QA blocker" below; this is the main correction of this pass.

| Item | What it fixes | Code | Deploy | Device QA |
| --- | --- | --- | --- | --- |
| A | "Something went wrong" on a second claim | ✅ | none | ⛔ needs a 2nd real deal |
| B | Pushes to repeat-blocked customers | ✅ | ⛔ 2 fns | ⛔ every business is `NONE` |
| C | Menu-promote forced poster style | ✅ | none | ✅ **passed on S10** |
| D | Double-tap the QR to redeem manually | ✅ | ✅ **v91 live** | ✅ **passed, both surfaces** |
| E | Google Wallet pass had no route into the app | ✅ | ⛔ 7 of 8 left | ⛔ needs a claim |
| — | Imageless ad for off-menu / no-menu items | ✅ | ✅ **v204 live** | ⛔ blocked — AI quota 30/30 |

Dan's deals from 2026-07-26 evening made claims possible again, which unblocked
D's device QA. **D is now fully verified** — see below.

The commits, newest first:

```
35ab4290  Sync deno.lock with the expo-build-properties dependency
7f533622  Make AI ad copy sound like the business that wrote it
6be0dc86  Add the pickup plan for finishing the five fixes
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

## What changed on the 2026-07-26 pass

Done:

- **T1 (push) — DONE.** The branch was already at `origin` and CI is green on
  `35ab4290`. The "8 commits, NOT pushed" line in the original draft was stale
  by the time it was written; two later commits also landed and are pushed.
- **`deno.lock` drift — DONE** (`35ab4290`), so open item 2 below is closed.
- **T7 (a DB test for B's queries) — DONE.**
  `scripts/db-tests/2j-repeat-claim-audience.mjs`, **13/13 passing**, added to
  `scripts/db-tests/run.mjs`. Details below.
- **Full code re-review of all five items.** Two minor issues and one edge case
  found, none of them blockers — recorded under "Findings from the re-review".

Found (and this is the important part):

- **The device QA for A, B, D and E is blocked on production test data**, not on
  Dan's availability and not on the deploys. The original doc called T2 "the
  cheapest remaining win… fully testable today". It is not testable at all right
  now. See the next section.
- **Two QA credentials in `.env.development.local` are dead.**

---

## The device-QA blocker (new, 2026-07-26)

Verified on the S10 against production, with the shopper session that was
already signed in on the device.

**Production currently has exactly one real, claimable deal**, and it was
outside its own daily window at the time of testing:

| Business | Deal | |
| --- | --- | --- |
| The Colonel's Brew | Buy any large coffee drink and get a free coffee | **REAL** |
| Cedar & Bean Cafe | 2-for-1 Pastry Pair Before Noon | demo |
| Cedar & Bean Cafe | BOGO Iced Tea Launch Special | demo |
| Cedar & Bean Cafe | Weekday Cold Brew 2-for-1 | demo |
| Cedar & Bean Cafe | Saturday Bakery Box BOGO | demo |
| Cedar & Bean Cafe | Buy One Latte, Get One Free | demo |

Why each item is stuck:

- **A** needs an active claim on a *different* deal. `claim-deal` only raises
  `CUSTOMER_ALREADY_HAS_ACTIVE_DEAL` when `activeRows.length > 0` *after*
  excluding the deal being claimed (`claim-deal/index.ts:600-613`). One real deal
  means there is no second deal to attempt.
- Demo deals cannot stand in for the second deal: `claim-deal` rejects
  `is_demo` at **index.ts:297**, long before the conflict check at :604. A demo
  deal always returns "This is sample content for testing only", never item A's
  error.
- **D and E** need one live claim to exist. The Colonel's Brew deal is
  recurring with a Sunday window of 8:00 AM – 12:00 PM; checked at 12:41 PM, the
  shop page showed **"No live deal right now"**, so not even one claim could be
  created. Its window reopens **Mon 6:30 AM – 12:00 PM**.
- **B (client half)** renders "Already used here" only for a business that
  restricts repeat customers. All three production businesses have
  `repeat_claim_policy_type = NONE`, so there is no data to render the state.

**To unblock, one of these has to happen first** (all are Dan's call):

1. Publish a second real deal so two claimable deals coexist — unblocks A. Note
   publishing fires a favorites-only push.
2. Run the QA inside the live deal's window (Mon 6:30 AM – 12:00 PM) — unblocks
   D and E, one claim, releasable afterwards.
3. Temporarily set a business's `repeat_claim_policy_type` to `FOREVER` —
   unblocks B's client half. The QA shopper already has 8 redemptions at The
   Colonel's Brew, so the blocked state would render immediately.

### Dead QA credentials

`TWOFER_QA_SHOPPER_EMAIL` / `_PASSWORD` and `TWOFER_QA_BUSINESS_EMAIL` /
`_PASSWORD` in `.env.development.local` **no longer authenticate against
production** (`400 invalid_credentials`). Working: `TWOFER_QA_OWNER_*` and
`TWOFER_SMOKE_*` — both are `unvmex2@hotmail.com`, whose `profiles.role` is
`business`, so neither can exercise a consumer claim path.

The S10 still holds a live shopper *session*, so UI-driven device QA works. But
any **script** that signs in as the shopper will fail until the credential is
refreshed. Worth fixing before the next QA session.

### S10 state left behind

Driving the QA changed device state Dan may notice:

- Consumer onboarding was completed on the dev client: location method =
  **current location**, nearby radius = **10 mi**, favorites step **skipped**
  (no favorites were added or removed).
- Android granted `Twofer Dev` **approximate** location, **while using the app**.
- Metro was stopped and `adb reverse tcp:8081` removed.

---

---

## Later on 2026-07-26: the imageless-ad fix (new, approved)

Dan reported that one deal — *"buy a ice cream sundae and get a free coffee"* —
would not generate, while four percent-off deals created minutes earlier were
fine. Diagnosis and fix below; **this needs one edge-function deploy to take
effect.**

### What it was not

The whole client offer pipeline handles that phrase correctly, proven by running
the real code:

- inference → `BUY_ONE_GET_SOMETHING_FREE`, required `ice cream sunday`
  (canonicalized to **`ice cream sundae`** — the misspelling fix in
  `canonicalizeOfferItem` works), reward `coffee`;
- eligibility passes at every retail-price combination, including none;
- the contract builds, and the deterministic fallback plus every headline and
  offer candidate pass `validateAiCopyAgainstOffer`.

So it was not parsing, not eligibility, not copy validation.

### What it was

For a cross-item free offer `buildRequiredVisualItems` returns **both** items, so
the image prompt demanded a visible ice cream sundae *and* a coffee. The four
deals that worked were `PERCENT_OFF_SINGLE_ITEM` — one item each. And there is
**no ice cream anywhere on that business's 54-item menu**; it is a coffee shop.

That is the failure class already documented at
`ai-generate-ad-variants/index.ts:3181` (F4, 2026-07-20): when the required
visible items cannot be rendered, both providers return no image, the fallback
chain burns ~2 minutes, and the request ended in a hard **502 `IMAGE_REQUIRED`**
— "AI image generation failed. Try again." Retrying could never help, because the
retry asks for the same picture.

**Caveat:** the exact error code from Dan's attempt could not be retrieved.
`ai_generation_logs` returns `*/0` and `deal_credit_ledger` 403s for the owner
account (both RLS-scoped, so emptiness proves nothing), the Supabase CLI has no
`functions logs` command, and `ad_generation_jobs` only records the dev
AI-Studio pipeline. The diagnosis is evidence-backed but the error string is
unconfirmed.

### The fix (Dan approved both locked files, AskUserQuestion, 2026-07-26)

Generalized past this one deal, because Dan's instruction was *"some stores may
not have an item on the menu or may not download their menu"*:

- `supabase/functions/ai-generate-ad-variants/index.ts` — the no-image branch
  returns the normal **200** ad payload with `poster_storage_path: null` and a
  new `image_fallback` field, instead of 502. Accounting is untouched: the
  reserved revision credit is still released, quota still does not tick, and the
  log row still records `IMAGE_NULL`. The chargeable-revision commit became the
  else-branch so a no-image generation can never be billed.
- `app/create/ai.tsx` — the client twin of that hard failure (an early return
  with an error banner) is gone. Generation continues into review with the
  gradient poster and an info banner (`createAi.noticeImagelessAd`, hand-written
  en/es/ko). `GENERATION_SUCCEEDED` gains `generated_without_image`.
  **The REVISION path deliberately still fails** on a missing image — accepting
  one there would silently swap a merchant's existing photo for a gradient.

This is safe because the native poster already renders without a photo
(`AdPosterCanvas` falls back to the template gradient), so an imageless ad is a
publishable creative, not a degraded one.

Not changed: `lib/quick-deal-ai-policy.ts` still lists `IMAGE_REQUIRED` in
`NON_FALLBACK_ERROR_CODES`. With the new function it never fires, and it remains
a correct guard against an older deployed version — removing it would add risk
for no gain.

New contract: `supabase/functions/_shared/ai-ad-imageless-fallback.test.ts`
(9 tests) pins both halves plus the gradient-poster assumption they rest on.

Two existing contracts pinned the old behaviour and were updated rather than
worked around:

- `supabase/functions/_shared/ai-generate-ad-variants-telemetry-source.test.ts`
  (unlocked) — "treats copy-only image fallback as an image production failure".
  Its intent survives; only the consequence changed, so it now asserts the
  accounting (credit released, `IMAGE_NULL` logged, `IMAGE_UNAVAILABLE` reason)
  instead of the old 502 status.
- `lib/create-ai-ux-source.test.ts` (**locked — separately approved by Dan**) —
  asserted the no-image gate appeared **≥2** times in `app/create/ai.tsx`. Now
  `toBe(1)`, renamed to "blocks a REVISION without an image, but lets first
  generation continue", plus assertions that the surviving `NO_IMAGE_RETURNED`
  belongs to the revision path. The tempting alternative — writing the app code
  as a bare `if ()` purely to keep the string count at 2 — was rejected: the
  assertion would pass while the test's name claimed a block that no longer
  exists.
`docs/ai-poster-core-lock.json` updated: new normalized sha256 for both files and
`latestApprovalRef` **chained** with `Prior ref:` (now 14 and 8 links).
Note the lock hashes are computed over CRLF-normalized text — hash the file with
`.replace(/\r\n/g, "\n")` or the gate will reject a correct entry.

### ✅ Deployed 2026-07-26 (Dan approved)

```bash
npx supabase functions deploy ai-generate-ad-variants
```

Live as **v204**. The server half is in production: a refused image now returns a
gradient-poster ad instead of 502. The client half ships with the next rebuild;
on a dev client it loads from Metro immediately.

⚠️ **Still unproven in production, and the diagnosis is not confirmed.** Two
things found while trying to verify it on 2026-07-26 evening:

- **The monthly AI limit is exhausted (30/30, resets on the 1st)**, so no
  generation can be run at all right now — by anyone, not just QA.
- Three deals generated at 21:42–21:47 UTC, *after* the deploy, and **all got
  real photos** — including "Buy a grilled cheese sandwich and get a free
  fountain drink", where neither item is on the menu. So the gradient fallback
  has never actually fired, and an off-menu cross-item offer demonstrably *can*
  get an image. That weakens the IMAGE_REQUIRED diagnosis for the sundae.

What it does rule out: the sundae failure was **not** the monthly cap, since
generations succeeded hours afterwards. If the sundae still fails once quota
resets, the cause was something else — capture the on-screen error text.

Until the rebuild, the **shipped v1.0.0 app** will receive the 200-with-no-image
response. It renders the gradient poster (that build's `AdPosterCanvas` already
handles a null `imageUri`) but shows no explanation of the missing photo.

---

## Also fixed on 2026-07-26: two item-D defects Dan hit on the S10

Both in unlocked files, both green, neither needs a deploy.

1. **The pass surface swallowed its own error.**
   `components/wallet-visual-pass.tsx` rendered the manual-redeem error inside
   `{qrWindowActive && token ? … }`, gated on the pass's own 30-second window. A
   failed double-tap therefore unmounted its own explanation when the countdown
   lapsed, so the tap read as doing nothing at all — exactly what Dan saw. The
   hint stays gated (it is only actionable while the QR is up); the error now
   outlives the window.

2. **An already-redeemed claim reported as a failure.**
   `lib/manual-redeem.ts` called `beginVisualRedeem` unconditionally, and a claim
   that finished mid-gesture — staff scanned it, or the 30s
   `VISUAL_REDEEM_AUTO_FINALIZE_MS` TTL auto-finalized one left in `redeeming` —
   comes back 409 "already been redeemed". That is the outcome the customer
   wanted, so it now falls through and lets `complete-visual-redeem` answer
   `already_redeemed: true`. Every other begin failure still throws.
   New: `lib/manual-redeem.test.ts` (7 tests).

### ✅ Device QA passed on the S10, 2026-07-26 evening — both QR surfaces

With `complete-visual-redeem` v91 live, a **single** double-tap now redeems. No
second tap, no 14-second wait, no error.

| Surface | Claimed | Redeemed | Method |
| --- | --- | --- | --- |
| Post-claim QR modal | 22:04:09 | 22:05:26 | `visual`, location stamped |
| Use Deal pass (the one Dan reported) | 22:08:31 | 22:13:35 | `visual`, location stamped |

Both wrote a `redemptions` audit row. The QR-modal run was driven over adb: the
hint rendered, the double-tap raised the branded confirm ("Redeem now?"), and
confirming closed the modal and flipped the card to Redeemed immediately. That
timing is the proof — `begin` and `complete` fire back-to-back inside
`manualRedeemClaim`, one round-trip apart, so under the old function the call was
guaranteed to be rejected by `MIN_MS`. The pass surface was confirmed by Dan by
hand, because slide-to-confirm cannot be driven by synthetic input:
`input swipe` and granular `input motionevent` are both ignored by
react-native-gesture-handler, which needs real touch timing (each adb command is
a separate process invocation seconds apart). **Automate the QR-modal surface;
ask a human for the pass slide.**

**Why Dan's two surfaces behaved differently before this:** they did not.
`complete-visual-redeem`
is still not deployed, so `manual: true` is ignored and the old 14s `MIN_MS` wait
applies to both. The claim record shows it: claimed 17:58:04, redeemed 17:59:39 —
95 seconds later, `redeem_method=visual`. The first double-tap started the clock
and was rejected; a later one, past 14s, succeeded. The preview QR only looked
better because its error stayed on screen. **T4 is what makes the instant path
work.**

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

### T1 — Push the branch  ✅ DONE

Branch is at `origin/qa/poster-ad-quality`, CI green on `35ab4290`.
`gate:release-state` passes locally too, so generated state is not stale.

---

### T2 — Device QA for item A  ⛔ BLOCKED (was: "cheapest remaining win")

**This is still the bug Dan reported first, but it is not testable until a
second real claimable deal exists in production.** See "The device-QA blocker".
Nothing about the fix is in doubt — 7 regression tests in
`lib/i18n/api-messages.test.ts` cover all five server strings plus the
code-map — but the end-to-end path has not been walked on a device.

Once a second real deal exists, the steps are unchanged:

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
columns it reads are already read by live code, so they exist — and as of this
pass, **both queries are proven against a real schema** by T7 rather than assumed.

**What changes for users:** customers a business has blocked from claiming again
stop getting that business's "new deal" pushes. Note that with every production
business currently on `repeat_claim_policy_type = NONE`, this deploy changes
nothing observable until a business actually sets a repeat limit — which also
makes it a very safe deploy.

**How to verify:** invoke the digest dry-run and read `repeat_restricted_users`
in the response; on a real release, `deal_push_events.metadata.repeat_blocked`
records how many recipients were filtered.

---

### T4 — Deploy D  ✅ DEPLOYED 2026-07-26 (Dan approved)

```bash
npx supabase functions deploy complete-visual-redeem
```

Live as **v91**. The `manual: true` flag now skips the 14s pacing wait, so a
single double-tap redeems instead of needing a second tap past 14 seconds.

⚠️ **Side effect worth knowing:** this deploy also carried item **E**'s changed
`_shared/wallet-pass-sync.ts` and `_shared/wallet-pass-content.ts` into
production, because they are bundled into `complete-visual-redeem`. So 1 of E's
8 functions is now running the `appLinkData` code. This is harmless as it
stands: `appLinkData` is only attached when the pass state is `active_deal`, and
`complete-visual-redeem` syncs the pass *after* redeeming, when the customer has
no active claim — so it never writes the field. The partial-deploy hazard in T5
(button appears then vanishes) needs `claim-deal`, which is still on the old
code. **T5 is still all-8-or-none for the remaining seven.**

⚠️ **Ordering matters.** If the app rebuild ships *before* this deploy, the
double-tap fails visibly with "Redemption window has not finished yet". Deploy
this first, or in the same window. (That sentence is now in `API_MESSAGE_KEY`,
so even in the wrong order the customer sees translated copy, not a raw string.)

**Device QA after deploy** (needs a claimable deal — see the blocker):
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
  batch** — and it stays unverified, since verifying it needs a re-issued pass,
  which needs a claim, which is currently impossible. It is de-risked:
  `upsertGoogleWalletObject` retries the write once without `appLinkData` on any
  4xx, so a wrong shape costs the button, not pass updates.
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

### T7 — A DB test for B's queries  ✅ DONE

`scripts/db-tests/2j-repeat-claim-audience.mjs` — **13/13 passing**, idempotent,
self-cleaning, wired into `scripts/db-tests/run.mjs`.

```bash
node scripts/db-tests/2j-repeat-claim-audience.mjs
```

It deliberately does **not** re-test B's decision logic (that is hermetic and
already unit-tested). It proves the part that could never fail loudly: the module
**fails open on any error**, so a wrong column or an unsupported operator would
have silently notified everyone with every unit test still green. It asserts:

- the two PostgREST reads, issued byte-for-byte as supabase-js serializes them,
  are accepted and return exactly the expected rows;
- `claim_status='redeemed'` excludes a customer whose only claim is still active
  (the deliberate non-block), and excludes a customer with no claims;
- only the three columns the pure selector reads come back;
- `order=redeemed_at.desc` really is newest-first, so first-row-per-pair judges
  on the latest redemption — the case a stale row would get wrong;
- 300 ids in one `.in()` (the `USER_CHUNK` value) is accepted, so a large
  audience cannot 414 into a silent fail-open;
- the `businesses` CHECK constraints keep `repeat_claim_policy_type` inside the
  three literals the normalizer knows, and forbid `COOLDOWN_DAYS` without a day
  count — the two schema facts that let the helper trust its inputs.

Fixture notes for whoever edits it next: `businesses` has a UNIQUE index on
`owner_id` (one business per owner in the pilot), so each fixture shop needs its
own throwaway owner; and `enforce_new_claim_business_capability` is a SECURITY
DEFINER trigger that service_role does **not** bypass, so a shop needs a trialing
subscription *and* a `terms_acceptances` row before any `deal_claims` insert is
allowed.

---

## Findings from the 2026-07-26 re-review

None of these blocks a deploy. Recorded so they are not re-discovered.

1. **`refreshQr()` still uses message-only translation.**
   `app/(tabs)/index.tsx:897` calls `mapClaimError` (an alias for
   `translateKnownApiMessage`), so that path gets the string-table improvements
   but not the new `error_code` map. Low impact — the table now carries the
   current wording — but it is the one claim call site item A did not convert.

2. **`repeat-claim-audience.ts` chunks users but not businesses.**
   `USER_CHUNK = 300` protects the `user_id` list, but `loadRestrictivePolicies`
   passes the whole `businessIds` array to one `.in()`, and `weekly-deal-digest`
   hands it every distinct business in the 7-day deal window. Harmless today
   (3 businesses in production); past ~300 the policy read could 414 and fail
   open silently. Worth the same chunking treatment eventually.

3. **D: a retried manual redeem >30s after a failed one reports an error even
   though the claim redeemed.** `manualRedeemClaim` calls `beginVisualRedeem`
   unconditionally. If a claim was left in `redeeming` for ≥30s
   (`VISUAL_REDEEM_AUTO_FINALIZE_MS`), `finalizeStaleVisualRedeemForClaim`
   auto-redeems it, and `begin-visual-redeem` then returns 409 "This claim has
   already been redeemed" — so the customer sees an error, and `onRedeemed`
   never fires so the list does not refresh. Narrow (needs a failed `complete`
   plus a retry more than 30s later) and the outcome is still correct; the
   wallet's redeemed-watch poll catches up. Could be smoothed by treating
   "already redeemed" from `begin` as success.

Everything else re-reviewed clean, in particular:

- D's server change is tightly fenced — a source contract pins `isManualCompletion`
  to **exactly two references**, and every real guard (ownership, deadline,
  status, location, MAX window) stays unconditional.
- E degrades safely: the `appLinkData` retry-without-the-field path keeps the
  card updating even if Google rejects the shape.
- A's resolution order (message → code → heuristic → mask) is right: only the
  message branch can interpolate a cooldown date, and the code branch catches
  backend rewording.
- ES/KO copy for every new key is hand-written with correct accents.

---

## Open items unrelated to shipping

1. **The dev APK talks to production.** `.env.development.local` and
   `docs/dev/AI_DEAL_STUDIO_SUPABASE_DEV_SETUP.md` both target
   `kvod…ovia` (prod), while `CLAUDE.md` says *"dev builds must use a separate
   Supabase development project, not production."* One of the two is wrong and
   should be reconciled. Right now "dev APK" means a differently-branded app on
   live data — which is also why the device QA above wrote against production.

2. ~~**`deno.lock` drift.**~~ Fixed in `35ab4290`.

3. **The test project is not a staging environment.** It has 10 edge functions;
   production has 79, and it is missing every function we changed. Making it a
   real staging target means deploying ~6 more functions plus seeding businesses,
   deals, favorites, push tokens and redemption history. Worth doing for launch
   confidence someday; it was not worth doing to unblock these fixes. Note that
   T7 now seeds businesses, subscriptions, terms, locations, deals and claims
   from scratch, so a chunk of that seeding work already exists to copy.

4. **Refresh the QA shopper credential** (see "Dead QA credentials"). Without it
   every scripted consumer-path check has to be driven by hand through the UI.

---

## Reusable: loading new JS onto the S10 without a rebuild

All the client changes here are pure JS, so the installed dev client picks them
up from Metro — no rebuild needed. Confirmed again on 2026-07-26:

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
  machine. They are **not** black on this device — a black frame just means the
  screen is off; `input keyevent KEYCODE_WAKEUP` then swipe up to unlock.
- `uiautomator dump /sdcard/ui.xml` + `cat` is more reliable than reading
  screenshots for finding tap targets, but bounds go stale — re-dump after every
  navigation.
- Kill Metro when done — `TaskStop` on the wrapper is not always enough; verify
  port 8081 is free afterwards, and `adb reverse --remove tcp:8081`.
