# Full-app device QA — pre-production-build pass

Date: 2026-08-06
Status: IN PROGRESS — nothing below is verified until its box is checked with
evidence (screenshot filename or command output) noted inline.
Device: physical S10 (SM-G973U1, RF8T20X0Z7P), dev client `com.unvmex2.twoforone.dev`,
Metro on :8081 with `EXPO_NO_METRO_LAZY=1`, `adb reverse tcp:8081`.
Branch under test: `feat/top3-improvements-20260806` (contains the 1.0.2 merge,
the AI-quality client batch, wallet QR timed reveal 83696b54 — never
device-tested — and today's top-3 batch).
Accounts: customer `test1@test.com`, business `test2@test.com` (pw 12345678,
Cedar & Bean Cafe). Creating new accounts, publishing, claiming, and AI
generation are all authorized (test environment, credit available).
Convention: this plan file IS the tracker. Suites run highest-value first,
sequentially (one device). Findings logged at the bottom with severity;
fix-as-you-go, all severities.

## Device-driving recipe (for every suite)

- `adb -s RF8T20X0Z7P shell input tap X Y` / `input text` (escape `@` → `\@`,
  space → `%s` — and ONLY spaces; `%` itself must not be doubled) /
  `input swipe` / `keyevent`.
- Screenshot: `adb shell screencap -p //sdcard/x.png` (DOUBLE slash — Git Bash
  mangles single `/sdcard`), `adb pull //sdcard/x.png <scratchpad>`, then Read
  the PNG. Never use uiautomator (RN views report [0,0][0,0] here).
- Coordinate math: screencaps are 1080x2280; the Read preview shows 947x2000 —
  multiply displayed coords by 1.14. Re-screenshot before every tap after any
  layout change.
- Metro is already running — do NOT restart it. If the app shows a connection
  error, re-run `adb reverse tcp:8081 tcp:8081`. If code changed, reload JS via
  force-stop + relaunch (`am force-stop com.unvmex2.twoforone.dev` + monkey
  launcher) — a running JS instance never reconnects on its own.
- AI generation takes ~45s; poll with screenshots.
- Switch accounts via Settings/Account → Log out (branded confirm modal).

## Suites (priority order)

### S1 — Merchant core loop: express create → AI generate → publish (P0)
The regression risk introduced this week. RUN 1 done (agent, ~2:15-3:15 PM);
found F-QA1 (P0, worse than hypothesized), fixed same session; re-verify run
pending below.
- [x] DEAD-END PROBE — result WORSE than the hypothesis: no dead end shown
      because a garbled mid-typing fragment ("ha") was silently seeded as the
      single item, the offer became fake-"Eligible", generation ran and failed.
      (s1_deadend8/9/12/18.) → F-QA1/F-QA2, FIX applied (see findings).
- [x] Happy path — PARTIAL: same fragment bug ("ho") reached the generated
      card AND a LIVE published deal title "Get 50% off one ho"
      (s1_happy_preview, s1_publish_verify_overview). AI image generation
      failed 3/3 (F-QA3); publish completed only via attach-photo bypass.
- [x] Published deal schedule sane: Aug 6 3:09→3:39 PM, not inverted
      (s1_publish_verify).
- [x] Express defaults reached server: 10 claims max, 15-min cutoff shown on
      the live deal (s1_publish_verify).
- [x] Express "tweak" link present + functional (s1_happy17_usead3).
- [x] Shims: twoforone://create/quick + /ai-compose land on express AI ads,
      no crash; needs explicit package with two Twofer installs
      (s1_shim_quick2, s1_shim_compose).
- [ ] RE-VERIFY after F-QA1 fix: dead-end probe now honestly blocks (clears
      fragment, auto-opens More options, banner visible); happy path infers
      "house latte" correctly; check whether AI image gen recovers once the
      item is not garbage (F-QA3 hypothesis).
- [ ] CLEANUP: end/pause the live garbled deal "Get 50% off one ho"; publish
      one clean deal to be S2's claim target.

### S2 — Consumer loop + wallet (P0)
- [ ] test1: claim the S1 deal → wallet Active shows it.
- [ ] Wallet QR TIMED REVEAL (83696b54, NEVER device-tested, ships in this
      build): reveal gating, countdown, re-hide behavior per its plan doc
      (docs/plans/wallet-qr-timed-reveal-plan-2026-08-02.md).
- [ ] "Add to Google Wallet" badge renders for test1. (Actually saving to
      Google Wallet + checking the pass's open-app action = founder step,
      Dan's Google account.)
- [ ] Release the claim → deal detail claim count RECOVERS (+1) — the
      released-claims-free-inventory fix, live end-to-end.
- [ ] Re-claim after release works.
- [ ] Consumer alerts opt-in: accept → Settings → notification mode STAYS
      area-wide default (not downgraded to favorites-only).

### S3 — Redemption E2E (P0, the money path)
- [ ] test2: redemption mode (PIN flow) → redeem test1's claim (scan or
      manual code entry).
- [ ] test1 wallet reflects redeemed state (Active → Ended, stats move).
- [ ] Merchant dashboard: claims/redemption counters move; en metric label is
      "Feed views"; counts sane vs today's activity.
- [ ] Released claims count as engagement in history but NOT against
      inventory.

### S4 — Cold start: new accounts (P1)
- [ ] Create BRAND-NEW customer: signup → 2-step onboarding (category picker,
      "Favorite a few shops" with no live-deal gating) → lands on Home sanely.
- [ ] Fresh-account alerts opt-in keeps area-wide default mode (GAP A fix on
      a truly cold account).
- [ ] Zero-crash pass through Map, Wallet (empty), Settings on the fresh
      account.
- [ ] If cheap: probe the TRUE-ZERO deals empty state (tight radius before
      favoriting anything) — growth CTAs should render, not "check back soon".
- [ ] Create BRAND-NEW business: business-setup completes; publish stays
      gated pre-approval; Start-trial copy renders. Do NOT enter any Stripe
      checkout.

### S5 — Other create paths + edit/revise (P1)
- [ ] Menu-offer path: lands at top with prefill banner; More options
      auto-EXPANDED (prefill entry rule).
- [ ] Reuse/template path: auto-expands; prefill correct.
- [ ] Edit a LIVE deal → regenerate creative with feedback → publish revision
      → deal stays live, creative actually updates (edit-deal revise fix).
- [ ] No publish-gate regressions from the express wrap on any path
      (validation errors must be VISIBLE when they fire).

### S6 — Polish sweep (P2, time-boxed ~20 min)
- [ ] Spanish + Korean spot-check on the NEW surfaces (express create, wallet
      pass, request-business, zero-deals state): no raw-English keys.
- [ ] Dashboard Feed views count sane (no re-inflation from today's cycles).
- [ ] Map renders; tap-through to deal detail.
- [ ] Share a deal → /s/<code> link resolves on the hosted share preview
      (curl is fine; don't post anywhere).

## Findings log

| # | Suite | Severity | Finding | Status |
|---|---|---|---|---|
| F-QA1 | S1 | P0 | Mid-typing fragments seed the eligibility item fields and STICK: `applyInferredEligibilityFromHint` nulled the merge-baseline ref on a null inference, so a briefly-usable prefix ("ho" from "house latte…", "ha" from "half off…") was treated as merchant input forever; with the offer form hidden behind the collapsed express expander the garbage flowed invisibly into generation and a LIVE deal title ("Get 50% off one ho"). Root cause read from source, repro'd live twice. | FIXED (commit pending this session): keep ref on null inference; new `finalizeInferredEligibilityFromHint` on hint blur + before generate clears stale auto-values via new `clearStaleAutoInference` (lib, unlocked) and auto-opens More options; generateAd bails with ineligible banner (reasonCode STALE_AUTO_INFERENCE_CLEARED). 4 new unit tests incl. both live-repro strings; source contract pinned. DEVICE RE-VERIFY PENDING |
| F-QA2 | S1 | P1 | Fake eligibility: vague text ("half off drinks today") silently showed "Eligible offer" + enabled Generate off the garbage seed — no warning while the form stayed hidden. Same root as F-QA1. | Covered by F-QA1 fix (gate now blocks honestly; collapsed "Not eligible yet" box is now a Pressable that opens More options) |
| F-QA3 | S1 | P0 (attribution open) | AI image generation failed 3/3 this run ("AI had trouble and there is no saved image to use for a fallback"), blocking the photo-less express flow entirely; publish succeeded only after manually attaching a photo. Hypothesis: downstream of F-QA1 (image prompts built around item "ho"/"ha" — same class as the old F4 garbage-item finding); alternative: real provider/infra outage. | OPEN — re-test post-fix with a clean item; if still failing, check ai-generate-ad-variants provider health server-side |
| F-QA4 | S1 | P1 | Revise panel's last button ("Revise ad") sits flush under the Android 3-button nav bar; 3 taps in the session hit Home instead. | FIXED: marginBottom 32 on the revise panel container. Device re-verify with the rest |
| F-QA5 | S1 | P2 | "Discard changes" on AI-ads back-navigation does not clear the saved draft — next entry still offers the discarded draft as "unfinished ad draft". Pre-existing (draft recovery), not from this week. | OPEN — backlog; label/behavior mismatch |
| F-QA6 | S1 | note | Bare `am start -d twoforone://…` opens Android's app chooser (prod + dev both claim the scheme); pass the package explicitly in future device QA. | Recipe note, not a bug |

## Session log

- ~2:15-3:15 PM: S1 run 1 (Sonnet agent, 302 tool calls). Dead-end probe found
  F-QA1 instead of the hypothesized visible dead end; garbled deal published
  live as evidence. Report + screenshots s1_*.
- ~3:20-3:45 PM: supervisor root-caused F-QA1 in source (ref-clear on null
  inference), implemented fix package (ai.tsx + lib/deal-eligibility-inference
  + tests), typecheck/tests/i18n/lock all green, lock re-hashed (chained ref).
