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
- [x] RE-VERIFY round 1 (~3:31 PM): FAILED — fragment still stuck. Root cause
      #2 found by supervisor: React batching — reading the baseline ref INSIDE
      the setState updater made every batched keystroke merge against the
      final inference; plus Android never fires onBlur on back-key keyboard
      dismiss. Round-2 fix 266320e8: capture-before-queue + 1.4s debounced
      settle (no auto-expand from debounce; tappable "Not eligible yet" box is
      the escape).
- [x] RE-VERIFY round 2 (~4:14-4:38 PM): ALL PASS on device. Vague text →
      honest "Not eligible yet" + underlined More options escape + EMPTY item
      field (s1w_a1-a4c). Clear text → item "house latte" exact (s1w_b1).
      Image gen succeeded first try with clean item — F-QA3 was downstream of
      F-QA1, resolved E2E (s1w_b3_2). Revise-panel nav-bar margin visible
      (s1w_b4). Full publish success: "Get 50% off one house latte", Live,
      4:14→5:02 PM (s1w_b5_3).
- [x] CLEANUP: "Get 50% off one ho" self-ended at 3:39 PM (window elapsed;
      s1v_cleanup1_ended). NOTE: whether a merchant can manually END a live
      deal was not probed — parked as a later question.
- [ ] adb quirk (not app): native TimePickerDialog ignores synthetic taps —
      schedule fine-tuning via adb impossible; use schedule PRESETS in future
      runs. S2 must stage its own longer-window deal via a preset.

### S2 — Consumer loop + wallet (P0) — RUN 10:33-11:00 PM, ALL PASS
Target deal: "Get 50% off one ny iced coffee" (Cedar & Bean, Irving),
10:33→11:32 PM, cap 10.
- [x] test1 claim → wallet Active shows the pass. Claims 10 → 9
      (s2_claim1b, s2_claim4).
- [x] **Wallet QR TIMED REVEAL device-verified for the first time** (83696b54):
      "Use deal" → slide-to-confirm → QR + claim code revealed with a
      **30-second "Staff scan window" countdown**; "Close" hides early and
      works. This MATCHES the spec exactly — the plan doc specifies 30s in
      five places. (s2_qr1_final, s2_qr2_final.) Staff hint banner
      ("double-tap the QR to mark used") present as designed.
- [x] "Add to Google Wallet" badge renders for test1 (s2_wallet2). Actually
      saving to Google + the pass's open-app action stays a FOUNDER step.
- [x] Release → deal claim count RECOVERS 9 → 10 (s2_rel2). Confirm copy:
      "…gives up your claim and returns it to the deal. You may not be able
      to claim it again if it sells out or reaches its daily limit."
- [x] Re-claim works: 10 → 9, pass back in Active, NEW code issued
      (s2_reclaim1). Full sequence 10 → 9 → 10 → 9.
- [ ] Consumer alerts opt-in mode preservation — NOT RUN this pass (deal
      clock); GAP A is covered on a cold account in S4 instead.

### S3 — Redemption E2E (P0, the money path) — RUN ~11:00 PM, ALL PASS
- [x] Merchant Redeem tab → Ticket code → entered the active code → success:
      "Redeemed — Get 50% off one ny iced coffee, Redeemed at 11:00 PM"
      (s3_redeem). NOTE: no PIN prompt before redeeming is BY DESIGN — the
      PIN (`exitPin`/`exitRedemptionMode`, app/redemption-mode.tsx:239-248)
      gates EXITING staff redemption mode, not redeeming as the owner.
- [x] test1 wallet: pass Active → Ended, "Redeemed" + "Redeemed by staff
      scan"; "Deals redeemed" 2 → 3; the earlier released claim still reads
      "Released", not redeemed (s3_wallet).
- [x] Merchant Offers: Claims 2 / Redeemed 1 / redeem rate 50% / Expired 0 —
      released claim counted as engagement but NOT against inventory, exactly
      the intended split (s3_merchant_offers).
- [ ] "Feed views" metric label — NOT observed: it lives behind the collapsed
      "monthly stats" section on the Dashboard tab
      (dashboard.tsx:1583, gated by `monthlyStatsOpen`); the agent only
      checked the Offers overview. Label exists and is correct in code;
      re-check by expanding monthly stats in a later pass.
- [ ] Staff redemption MODE (the PIN-locked handoff screen) never exercised —
      coverage gap, not a defect.

### S4 — Cold start: new accounts (P1) — BLOCKED by env
- [ ] Create BRAND-NEW customer — **BLOCKED**: signup form works correctly
      (shopper-role default, password strength meter, terms checkbox gating
      submit) but lands on "Check your email" and refuses sign-in until
      confirmed; no access to the @twoferapp.com mailbox
      (s4_signup13/14/15). Onboarding, cold zero-state, and fresh-account
      GAP A therefore UNVERIFIED. **Needs a founder decision** — confirm a QA
      address, or enable auto-confirm for test signups.
- [x] GAP A on the EXISTING account instead (S7 run): mode preserved
      "All nearby deals" → "All nearby deals" across an alerts-enable
      attempt; did NOT flip to Favorites only (s7_mode_before/after).
      CAVEAT: the toggle never reached ON because push registration fails in
      the dev client (no FCM creds — branded error, clear copy). Only the
      attempt path was exercised; a store build can confirm the ON state.
- [ ] TRUE-ZERO empty state (GAP B) — **BLOCKED, could not be observed**:
      seeded DEMO deals ("Demo offer" pill, ~24-day windows) keep the
      favorites row and feed permanently non-empty on every account, so the
      zero branch never renders in this environment (s7_zero1/2). Covered by
      unit/source tests only. Needs demo teardown or a deal-free location.
- [ ] Create BRAND-NEW business — not attempted (same email-confirmation
      blocker class).

### S5 — Other create paths + edit/revise (P1) — ALL PASS
- [x] Menu-offer path: lands at TOP with "Deal prefilled from your menu item"
      banner and More options AUTO-EXPANDED — Offer rules, single item
      ("The Colonel's Shot (Espresso)"), 50%, honest "Eligible offer",
      schedule, and "10 claims max, 15 min cutoff" all visible without extra
      taps (s5_menu1, s5_menu5_scroll, s5_menu6_scroll2).
- [x] Reuse/template path: auto-EXPANDED with correct prefill (item "ny iced
      coffee", 50%, price 5.99) (s5_reuse1_top, s5_reuse9_header).
- [x] Edit/revise: NOTE the UI has no "Edit" for ENDED deals — Manage offers
      Duplicate / Print flyer / Delete (plan wording was wrong). Duplicate is
      the edit-equivalent entry and auto-EXPANDS. Revise panel worked end to
      end: "make it punchier" → headline "HALF OFF ICED COFFEE" →
      "COFFEE RUN, COLDER" (s5_edit13_revise, s5_edit2_revise_result).
      Discarded, not published — verified 0 live / 24 total unchanged.
- [x] F-QA4 bottom inset re-confirmed: final button clears the nav bar
      (s5_inset2_bottom).

### S6 — Polish sweep (P2) — NOT RUN
Deferred: all deals had expired and the demo-deal/blocked-signup limitations
above cap what a polish pass could observe tonight. Share-link resolution was
already verified server-side earlier today (x-share-preview-match: query).

## Findings log

| # | Suite | Severity | Finding | Status |
|---|---|---|---|---|
| F-QA1 | S1 | P0 | Mid-typing fragments seed the eligibility item fields and STICK, then ship: TWO stacked defects — (a) `applyInferredEligibilityFromHint` nulled the merge-baseline ref on a null inference, orphaning seeded fragments as if merchant-entered; (b) React batching: the baseline ref was read INSIDE the setState updater, so batched keystrokes all merged against the final inference and the first fragment ("ho"/"ha") survived every correct later one. Express hid the form → garbage reached a LIVE deal title ("Get 50% off one ho"). Both roots read from source, repro'd live. | FIXED c97544eb + 266320e8: keep ref on null; capture-before-queue baseline; `finalizeInferredEligibilityFromHint` on blur (iOS), 1.4s debounce after typing stops (Android), and before generate (expands + bails w/ reasonCode STALE_AUTO_INFERENCE_CLEARED); `clearStaleAutoInference` in unlocked lib. **DEVICE-VERIFIED FIXED 4:38 PM** (s1w_a1-a4c, s1w_b1) |
| F-QA2 | S1 | P1 | Fake eligibility: vague text silently showed "Eligible offer" + enabled Generate off the garbage seed. Same root as F-QA1. | FIXED with F-QA1; device-verified: vague text now yields honest "Not eligible yet" + tappable More options escape (s1w_a1) |
| F-QA3 | S1 | P0→resolved | AI image generation failed 3/3 in run 1 ("AI had trouble... no saved image"). | RESOLVED — downstream of F-QA1, confirmed twice: manual item correction (s1v_gen_p45) and post-fix E2E (s1w_b3_2) both generated first-try. NOT a provider outage |
| F-QA4 | S1 | P1 | Revise panel's last button sat flush under the Android 3-button nav bar; taps hit Home. | FIXED (marginBottom 32) + device-verified (s1w_b4) |
| F-QA5 | S1 | P2 | "Discard changes" on AI-ads back-navigation does not clear the saved draft — next entry still offers the discarded draft as "unfinished ad draft". Pre-existing (draft recovery), not from this week. | OPEN — backlog; label/behavior mismatch |
| F-QA6 | S1 | note | Bare `am start -d twoforone://…` opens Android's app chooser (prod + dev both claim the scheme); pass the package explicitly in future device QA. | Recipe note, not a bug |
| F-QA7 | S2 | P2 | A HIDDEN business silently suppresses its deals everywhere (feed, Shops, search) even when the user has FAVORITED it, and nothing outside that business's own detail page indicates why — the favorites row gives no hint. Produced a dead end indistinguishable from "deal out of range" and cost a full agent run. Pre-existing (hide feature), not from this week's batch. | OPEN — recommend a "Hidden" chip on favorites/shops rows + unhide affordance |
| F-QA8 | S3 | non-finding | Agent flagged "Redeem tab has NO PIN/staff-auth gate" as a security gap. VERIFIED NOT A BUG: the PIN gates EXITING staff redemption mode (`exitPin` → `exitRedemptionMode`, app/redemption-mode.tsx:239-248), protecting the staff-handoff lock. Redeeming as the already-authenticated owner needs no second gate. | CLOSED — no change |
| F-QA9 | S2 | tester error | Agent flagged the QR "Staff scan window" 30s countdown as deviating from an expected "~4 min / Hide in 3:59". **The 3:59 figure was fabricated by the supervisor in the agent brief** — docs/plans/wallet-qr-timed-reveal-plan-2026-08-02.md specifies 30 SECONDS in five places. Observed behavior matches spec. | CLOSED — brief was wrong, app is right |
| F-QA10 | S3 | tester error | Agent reported "Feed views" label missing. It renders at dashboard.tsx:1583 behind the collapsed `monthlyStatsOpen` section on the Dashboard tab; the agent searched only the Offers overview. | CLOSED — coverage gap, re-check later |
| F-QA11 | S2 | note | Claim codes render as "XXX YYY" (e.g. "TH9 E84"), not the "TWOFER-XXXXXX" format the supervisor's brief assumed. Brief was wrong. | CLOSED — no issue |
| — | S3 | answered | Parked question "can a merchant end a live deal early?" → YES: "End deal early" with confirm "This will deactivate the deal immediately. Active claims can still be redeemed." | CLOSED |
| F-QA12 | S4 | env-blocker | New-account signup requires email confirmation; QA has no @twoferapp.com mailbox, so cold-start coverage (onboarding, fresh-account GAP A, new business setup) is unreachable on device. | OPEN — founder decision needed (confirm an address, or auto-confirm test signups) |
| F-QA13 | S4 | env-blocker | Seeded DEMO deals (~24-day windows, "Demo offer" pill) keep every account's feed non-empty, so the GAP B true-zero empty state can never render on device here. Matches the known "5 of 6 live deals are demo" state. | OPEN — needs demo teardown to verify; unit/source tests cover the branch |
| F-QA14 | S5 | P2 (accepted) | Duplicating a historical deal reloads its stored item text verbatim (e.g. the pre-fix "ho" artifact) and shows "Eligible offer" — the validator only checks discount + non-empty item, so it cannot know the text is nonsense. NOT a new regression: the F-QA1 fix stops NEW garbage, and duplicate entries auto-expand More options so the bad text is now VISIBLE and editable before publish. | ACCEPTED — no fix; historical rows stay as-is |
| F-QA15 | S5 | P3 | Ended deals expose no "Edit" action (only Duplicate / Run again / Print / Delete). Plan wording assumed "Edit"; UI vocabulary differs. | CLOSED — terminology note |

## Session log

- ~2:15-3:15 PM: S1 run 1 (Sonnet agent, 302 tool calls). Dead-end probe found
  F-QA1 instead of the hypothesized visible dead end; garbled deal published
  live as evidence. Report + screenshots s1_*.
- ~3:20-3:45 PM: supervisor root-caused F-QA1 in source (ref-clear on null
  inference), implemented fix package (ai.tsx + lib/deal-eligibility-inference
  + tests), typecheck/tests/i18n/lock all green, lock re-hashed (chained ref).
- ~3:31 PM: re-verify round 1 FAILED → second root cause (React batching:
  baseline ref read inside the setState updater) + Android never fires onBlur
  on back-key dismiss. Round-2 fix 266320e8 (capture-before-queue + 1.4s
  debounced settle). Re-verify round 2 (~4:14-4:38 PM) ALL PASS on device;
  F-QA3 proven downstream of F-QA1.
- ~5:15 PM: S2 attempt 1 died on an API session limit after 334 tool calls,
  having burned the run hunting a deal that was invisible for two reasons
  (window already expired + the hidden-business trap, later F-QA7).
- 10:33-11:05 PM: S2+S3 run as ONE agent (deals live only ~60 min, so the
  suites cannot be split across agents). Every P0 assertion passed: claim,
  first-ever device verification of the wallet QR 30s timed reveal, release
  → inventory recovery 9→10, re-claim, staff redeem, and both-sides
  reconciliation. Supervisor QA of the report then dissolved 3 of its 6
  findings (F-QA8/9/10) — two of them caused by fabricated expectations in
  the supervisor's own brief; corrected here rather than filed against the
  app.
- 11:20-11:55 PM: S4+S5 agent. S4 BLOCKED at signup (email confirmation);
  S5 ALL PASS — the express auto-expand contract holds on every prefill path
  (menu-offer, reuse, duplicate) and the revise loop works end to end.
- ~12:05 AM: focused run for the two still-unverified fixes from this week's
  batch. GAP A PASS (mode preserved). GAP B BLOCKED by seeded demo deals.

## Build-readiness verdict (2026-08-07 ~12:15 AM)

GO for the production build, with eyes open:
- Every P0 on the money path is device-verified: express create → AI generate
  → publish; claim; wallet QR 30s timed reveal (FIRST device verification of
  83696b54); release → inventory recovery 9→10; re-claim; staff redeem; and
  both-sides reconciliation.
- One genuine P0 regression was found and fixed mid-pass (F-QA1, two stacked
  root causes) then re-verified on device. It had already shipped garbage into
  a live customer-facing deal title, so catching it before the build was the
  whole point of this exercise.
- Residual UNVERIFIED items are environment-blocked, not suspected-broken:
  cold-start onboarding + fresh-account GAP A (F-QA12), true-zero empty state
  (F-QA13), staff redemption MODE, the "Feed views" tile behind the collapsed
  monthly-stats section, Google Wallet save + open-app action (founder step),
  and the /wallet deep link (needs the new binary itself).
- Known open UX debt, none build-blocking: F-QA5 (discard leaves draft),
  F-QA7 (hidden business silently suppresses favorited deals).
