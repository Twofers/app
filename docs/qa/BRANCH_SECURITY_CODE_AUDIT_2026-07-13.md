# Clean Security & Code Audit — branch `qa/db-guardrails-and-auth-tests`

**Date:** 2026-07-13
**Scope:** All working-tree + new-untracked changes on this branch vs `HEAD`, plus the immediate code they touch.
**Method:** 8 surface-scoped finder agents → dedupe → **adversarial verification of every finding** (each finding handed to an independent skeptic instructed to refute it against the real code). 45 agents total.
**Result:** 37 findings survived verification (**0 refuted**). 30 CONFIRMED, 7 PLAUSIBLE.

> This is a review-only audit. No code was changed. Each finding lists a concrete remediation.

## Headline

- **No critical or high-severity issues.** The two highest are **medium**, both on the *public unauthenticated intake* rate limiter — not on the new quick-approval feature.
- The new **email "quick approval" feature is a deliberate magic-link design and holds up under scrutiny.** Its token is 256-bit, single-use, SHA-256-hashed at rest, 30-minute TTL, fragment-delivered, and eligibility is server-re-checked on confirm with a processing-claim concurrency guard. Adversarial verification **downgraded** most quick-approval concerns from the finders' initial high/medium to low/info because brute-force is infeasible and the flow stays human-gated. The residual items are real but are **defense-in-depth, MFA-policy, and audit-observability hardening**, not exploitable bypasses.
- The **QA auto-login** added to `app/auth-landing.tsx` is `__DEV__`-gated and dead-code-eliminated in release builds. The residual concern is a plaintext password accepted via a deep-link URL query param (logcat/screen-recording exposure) on dev builds.

### Severity summary

| Severity | Count | Where |
|---|---:|---|
| Critical | 0 | — |
| High | 0 | — |
| **Medium** | **2** | public intake rate limiter (`submit-business-application`) |
| Low | 19 | quick-approval hardening, QA-login, offer-copy, consent record |
| Info | 16 | CORS/CSP notes, gate-script quality, locked-file record, fixtures |

### By surface

`quick-approval` 20 · `public-intake` 5 · `app-auth`/`qa-auto-login` 6 · `offer-contract-copy` 3 · `onboarding-layout` 1 · `composed-ad-card` 1 · `android-build` 1

---

## Remediation log — 2026-07-13

Priority #1 (public intake) plus adjacent hardening applied and validated. **Not committed, not deployed** — edge-function deploys are gated on Dan's approval; fixes take effect only after `submit-business-application`, `submit-launch-signup`, and `admin-auth-session` are redeployed.

- ✅ **M1** — trusted client-IP derivation + client-independent flood ceiling.
- ✅ **M2** — reordered counted insert ahead of outbound email (race window narrowed); atomic-counter version delivered as [`proposed-m2-atomic-rate-limit.sql`](proposed-m2-atomic-rate-limit.sql) (needs migration approval to apply — hard-gated).
- ✅ **Hardening (report follow-up "b")** — extracted the IP logic to a shared, unit-tested [`_shared/client-ip.ts`](../../supabase/functions/_shared/client-ip.ts) and wired all three functions (`submit-business-application`, `submit-launch-signup`, `admin-auth-session`) to it, killing 3 copies of the leftmost-XFF anti-pattern; removed a 4th **dead** copy exported from `_shared/admin-prospects.ts`. New behavioral test `client-ip.test.ts` proves a spoofed leftmost hop cannot win.
- ✅ **L7** — persist real consent booleans.

**Round 2 — quick-approval + intake hardening (committed separately):**
- ✅ **L2** — `quick_preview` now writes an `admin_business_application_quick_previewed` audit row (attributed to the issued-to admin), closing the unaudited-PII-read gap.
- ✅ **L4** — `quick_confirm` re-runs `hasPossibleDuplicate` on the freshly claimed row (exported from `admin-quick-approval.ts`); a duplicate that raced in after mint now releases the claim and falls back to manual review.
- ✅ **L5** — the single-use `token_used_at` write is now best-effort and runs after `completed=true`; a bookkeeping error no longer fails the request or leaves the (already-granted, already-audited) link falsely retryable.
- ✅ **I-HONEYPOT** — the tripped honeypot now returns the exact success shape (`{ok:true, onboarding_saved:true}`), so a bot can't detect it by response diffing.
- ✅ **I-EMAILURL** — the approve-button href is emitted only for an `https://` URL, so `escapeHtml` is never the sole guard on that attribute.
- **Validation (both rounds):** `npm run typecheck:functions` (exit 0) · full edge-function suite **688/688** · `check-website-supabase-readiness.js` passed.

**Round 3 — app-side + decisions (2026-07-13):**
- ✅ **L9** — QA auto-login password now comes only from native launch arguments, never a deep-link URL param (kills the logcat/screen-record leak). In `app/auth-landing.tsx`; `tsc --noEmit` clean; **uncommitted** (rides with the staged QA-login work).
- 🟡 **L6** — **accepted, won't fix** (low, human-gated; cheap mitigation would be security theater). See L6 above.
- ⏸️ **L10** — **no change:** the current strip is already Dan-approved (manifest line 89), and the audit's "strip only periods" suggestion would *worsen* output (`Yum!.`); the only residual needs an impossible all-punctuation business name.
- ⏸️ **I-AI** — `AdAccessibilityText.tsx` is **not** in the lock manifest, so it isn't gated; the change is a benign a11y normalization. Open offer: add it to the manifest if per-file gating is wanted.

**Still your action:**
- Push the 2 commits (`git push origin qa/db-guardrails-and-auth-tests`) — blocked for me by the permission mode.

---

## MEDIUM

### M1 — Per-IP rate limit trusts client-supplied `X-Forwarded-For` (CONFIRMED) — ✅ FIXED 2026-07-13
**`supabase/functions/submit-business-application/index.ts:20,299`**

> **Resolution:** Replaced `firstForwardedIp` (leftmost hop) with `clientIpFromRequest()` — prefers unspoofable edge/CDN headers (`cf-connecting-ip`/`x-real-ip`/`fly-client-ip`), else the **rightmost valid** XFF hop, and validates each candidate as a real IP (`isLikelyIpAddress`, 45-char cap) so arbitrary text can never key the limiter or land in `ip_address`. Added a client-independent flood ceiling (`RATE_LIMIT_MAX_ALERTS_PER_WINDOW = 40`) that suppresses the outbound admin alert + quick-approval mint when exceeded — bounding Resend cost / inbox flood / one-click links even if the per-actor caps are evaded by rotating valid IPs. Source test updated; `npm run typecheck:functions` + 664 shared tests + readiness gate all green.


`firstForwardedIp()` returns `header.split(",")[0]` — the **leftmost** XFF entry, which is attacker-controlled (Supabase's edge appends the real client IP to the right rather than replacing the header). This value is the sole key for the per-IP cap (8/30 min) and is persisted verbatim as `business_onboarding_requests.ip_address`. The per-email cap (3/30 min) keys on an unverified email, trivially rotated. On a `verify_jwt=false` endpoint, the only other control is the `company_website` honeypot.

**Deep analysis:** Each accepted request inserts an application row, mints a quick-approval token, and sends an outbound Resend admin email. Defeating both caps → unbounded DB writes + unbounded admin emails (Resend cost/quota exhaustion, inbox flooding, one-click approve buttons) and attacker-chosen `ip_address` audit values. Bounded to abuse/DoS/cost + audit-integrity — no data disclosure. Downgraded to medium because exploitability depends on the platform's (documented, but undocumented-by-contract) XFF-append behavior.

**Actionable insight:** Never trust the leftmost XFF hop. Derive the client IP from a trusted source and validate it as a real IP literal before using it as a key or storing it.

**How to resolve:** Replace `firstForwardedIp` to take the **rightmost trusted hop** (or Deno `conn` info); reject non-IP-shaped values; add a length cap so arbitrary text can never land in `ip_address`; add a client-independent global window cap as a backstop.

### M2 — Count-based rate limiter is racy (check-then-act TOCTOU) (CONFIRMED) — ✅ MITIGATED 2026-07-13
**`supabase/functions/submit-business-application/index.ts:32,392`**

> **Resolution:** Reordered so the throttle-counted `createOnboardingRequest` runs **before** the outbound admin email + token mint, removing network I/O from the check→count window, and gated those costly side effects behind the new flood ceiling. This bounds the burst-amplification harm without a schema change. **Residual (by design):** fully eliminating the check-then-act gap needs a DB-side atomic counter (unique constraint / advisory-lock RPC) = a **migration**, which is hard-gated to apply — left as an optional follow-up rather than shipping code that depends on an unapplied migration.


`isRateLimited()` does a `SELECT count` and returns before any write. The row it counts (`createOnboardingRequest`) is inserted **last** — after the application insert, token mint, and the outbound admin email. So N concurrent submissions all read `count < cap` and all proceed. Wide window because the intervening awaits include network I/O (the Resend call).

**Deep analysis:** Compounds M1 — even without XFF spoofing, concurrency alone lets a burst exceed the intended per-email/per-IP ceilings. ~20 concurrent POSTs → ~20 inserts, ~20 tokens, ~20 admin emails. Steady-state sequential throttle still works; exposure is burst amplification.

**Actionable insight:** Make the check-and-count atomic, and count the "attempt" *before* doing side effects.

**How to resolve:** Insert a dedicated rate-limit ledger row (or the onboarding row) up front under a unique/serialized constraint, or use an atomic SQL RPC that checks-and-records in one statement; only then mint the token and send the email.

---

## LOW

### L1 — Quick-approval is an unauthenticated bearer-token capability that bypasses the admin MFA gate (CONFIRMED + PLAUSIBLE)
**`admin-business-applications/index.ts:659,742,969`** *(consolidates 3 findings)*

`quick_preview`/`quick_confirm` are dispatched **before** `requireAdmin()`, so they never evaluate `require_mfa`/AAL2 — the guard the interactive dashboard enforces at `index.ts:265`. `loadQuickApprovalContext` validates the issued-to admin only for `is_active` + decision-capable role; it doesn't even `SELECT require_mfa`. So an `approve_full` 30-day grant can execute from token possession alone, even for an MFA-required admin. The default alert inbox is the **public** `support@twoferapp.com`; if that shared mailbox is registered as a decision-capable admin, approval authority collapses to "anyone who can read that inbox," and every quick approval is audited under the inbox-owner admin regardless of who clicked.

**Deep analysis:** Bounded — only one pre-screened (`risk≥70`, non-duplicate, terms-accepted, pending) application, only to the trial tier, single-use token. It's a standard magic-link, but it is a *strictly weaker* channel than the UI it parallels, and the only exploit precondition is compromise/interception of a specific trusted admin mailbox (which is already the account-recovery channel).

**Actionable insight:** Decide explicitly whether email possession may substitute for MFA on a decision action, and never point `ADMIN_ALERT_EMAIL` at a shared/public alias.

**How to resolve:** In `loadQuickApprovalContext`, also select `require_mfa`; if the issued-to admin has it set, return `quickApprovalUnavailable` **and** skip minting in `mintFullTrialQuickApproval`. Alternatively require `quick_confirm` to additionally pass `requireAdmin()` with AAL2 (turning the link into a convenience deep-link). Add a config assertion that `ADMIN_ALERT_EMAIL` ≠ `support@twoferapp.com`, and record a **distinct audit action** (e.g. `..._approved_full_quick_email`) with an explicit channel flag so email approvals are queryable-distinct from UI approvals.

> **Operator context (2026-07-13, verified re-assessment):** Dan is a solo founder and `support@twoferapp.com` is a **single-access inbox that only he reads** (not a shared alias). This **dissolves the two load-bearing parts of L1**: (a) "authority collapses across many readers" — the reader set is `{Dan}`, who is already the sole decision-maker, so the feature does not widen who can approve; and (b) "audit attribution smears across readers" — `admin_audit_log` records the single `issued_to` admin identity Dan controls, which is accurate and non-repudiable. **L1 downgrades to LOW/informational on the code.** What remains real: the **`require_mfa`/AAL2 bypass** (the quick path never reads `require_mfa`) and the fact that **the mailbox is now the trust anchor** for this one action. Verified mitigation posture for a solo operator who cannot use a separate inbox:
> 1. **Harden the email account itself** — phishing-resistant MFA on `support@` (passkey / hardware key / TOTP; **not** SMS). This directly substitutes for the skipped AAL2. *Doing nothing on the code is fine; doing nothing on the mailbox is not.*
> 2. **No auto-forwarding rules / no stray third-party OAuth grants** on the mailbox — either would silently re-introduce the multi-reader problem and reactivate (a)/(b).
> 3. **Free kill-switch (no code change):** a token only mints when `ADMIN_ALERT_EMAIL` maps to an *active, decision-capable* `admin_users` row. Deactivate/downgrade that row, or point `ADMIN_ALERT_EMAIL` at an inbox that is **not** a registered admin, and no token ever mints — the email ships with only the "Review in admin" link.
> 4. **Optional, only if `require_mfa=true` and you want email-compromise-alone to be insufficient for approvals:** route `quick_confirm` through `requireAdmin()` (AAL2), turning the link into a fast shortcut *into* the signed-in dashboard rather than standalone authority. Not required given the bounded blast radius (one pre-screened, non-duplicate, low-risk `approve_full` trial; materializes nothing until the real owner signs in with a confirmed email; billing gate bypassed).
> 5. Blast radius is **reversible** — worst case is a spurious low-value trial you can reject/suspend, not money movement or data exposure. **Revisit the moment** `support@` gains a second reader, becomes a shared alias, or forwards to a team address.

### L2 — `quick_preview` discloses applicant PII with no audit log, replayable within the TTL (CONFIRMED)
**`admin-business-applications/index.ts:675`** *(consolidates 2 findings)*

`previewQuickApproval` returns `business_name, contact_name, email, address, business_type, risk_score` and writes **no** `admin_audit_log` row — unlike every other action in the function. It doesn't consume the token, so it's callable unlimited times for the 30-min window with zero trace.

**Deep analysis:** Bounded by the 256-bit token secrecy; the disclosed data is the applicant's own contact info an admin may review. The defect is the *asymmetry*: the mutating confirm is audited, the PII-read preview is not — a real accountability gap on the most sensitive (unauthenticated) surface.

**Actionable insight:** Audit every `quick_preview`/`quick_confirm` attempt (success and failure), keyed by application id + issued-to admin.

**How to resolve:** After `loadQuickApprovalContext` succeeds in `previewQuickApproval`, insert an `admin_audit_log` row (`action: admin_business_application_quick_previewed`, `target_id`, `admin_user_id`, `request_id`). Trim the preview payload to the minimum the decision needs.

### L3 — No rate limiting / lockout on the quick-approval actions; status codes form a token-state oracle (CONFIRMED)
**`admin-business-applications/index.ts:593`**

Neither quick action is throttled. Responses are distinguishable: `410` invalid/expired/used, `409` "already processing", `500` internal. Brute-force is infeasible (256-bit), so the practical risk is a mild uncapped-DB-lookup DoS surface + a (near-useless) validity oracle.

**Actionable insight:** Add coarse rate limiting and collapse failure responses to one generic outcome.

**How to resolve:** Reuse the rate-limit helper pattern to cap per source IP; return a uniform `410`/generic body for all not-usable states so `409` isn't externally distinguishable. Keep real state in logs only.

### L4 — Duplicate-applicant guard runs only at mint, not re-checked at confirm (CONFIRMED)
**`supabase/functions/_shared/admin-quick-approval.ts:95`**

`hasPossibleDuplicate` screens at token-mint time; `confirmQuickApproval` re-checks status/tier/verification/risk/expiry/single-use but **not** duplicates. If a business for the same merchant materializes within the 30-min window (requires a privileged admin approving a sibling application), the quick confirm still grants a second full trial.

**Actionable insight:** Re-run the duplicate screen inside `confirmQuickApproval` on the freshly-claimed row.

**How to resolve:** Export/reuse `hasPossibleDuplicate`; call it after the processing-claim succeeds; if a duplicate now exists, roll back the claim and return `quickApprovalUnavailable` so it falls back to manual review.

### L5 — Successful approval with failed single-use bookkeeping leaves `token_used_at` NULL (CONFIRMED)
**`admin-business-applications/index.ts:760`**

`applyDecision` runs first (grants trial, sends email, writes audit, flips status → `trial_active`). Only then is `quick_approval_token_used_at` set in a separate UPDATE. If that trailing UPDATE fails, `finally` clears only the processing claim "to let the link retry" — but retry is dead (eligibility now requires `pending_review`). Net: trial is approved but the token is recorded as never consumed, and the row lingers in the partial expiry index.

**Deep analysis:** Fails *safe* against double-approval — pure bookkeeping/observability defect, not a security issue.

**Actionable insight:** Mark the token consumed atomically with — or before — committing the decision.

**How to resolve:** Set `quick_approval_token_used_at` in the same guarded UPDATE that flips status to `trial_active` (or right after the claim, before `applyDecision`). Alternatively, retry the `used_at` write on the completion-failure branch instead of only clearing the claim.

### L6 — Forgeable `verified_low_risk` state mints a one-click full-trial approval email (PLAUSIBLE) — 🟡 ACCEPTED (won't fix) 2026-07-13
**`submit-business-application/index.ts:211`**

> **Decision (Dan, 2026-07-13): accept the risk, no code change.** Rationale: the verifier downgraded this to low because the flow stays **human-gated** — a forged low-risk application only produces a review email with a one-click button; an admin must still click Confirm, and email confirmation is required before anything materializes, so nothing auto-grants. The cheap mitigation (require a `website_or_instagram` value) is **security theater** — that field is unverified free text an attacker can fake. The real fixes (resolve/verify the domain at submit; or rename `verified_low_risk` via a migration) are disproportionate to a low, human-gated finding. Revisit only if quick-approval is ever made non-interactive (auto-approve without a human click).


`scoreApplication` reaches `≥70` purely from self-reported free text: phone (+10), a DFW keyword like "dallas" (+15), any address (+10), any website/instagram (+15), business_type containing "coffee/cafe/bakery" (+10) → 75. That state is exactly the quick-approval eligibility gate. The label `verified_low_risk` overstates a forgeable heuristic; the prohibited-category screen is naive substring matching.

**Deep analysis:** Verifier downgraded to PLAUSIBLE/low: eligibility only mints an *email link*; materialization needs a human admin click **and** the real owner to sign in with a confirmed email — no self-service grant. Real risk is alert-fatigue one-click approval of a polished fake, not an authz bypass.

**Actionable insight:** Treat the score as a triage hint, never "verified." Require an externally-corroborated signal before an application can mint the one-click approve link.

**How to resolve:** Gate quick-approval eligibility on something the submitter can't self-assert (verified email/domain or manual pre-check); rebalance `scoreApplication` so a fully self-reported form can't alone cross the threshold; make the prohibited-category screen word-boundary/token based; rename `verified_low_risk`.

### L7 — Consent booleans hardcoded `true` in the application insert (CONFIRMED) — ✅ FIXED 2026-07-13
**`submit-business-application/index.ts:345`**

The insert wrote literal `terms_accepted: true` / `privacy_acknowledged: true` instead of the validated `termsAccepted`/`privacyAcknowledged`. Correct only because the required-fields guard rejects anything not strictly true. Fragile for a **legal-consent record** if that guard is ever relaxed.

> **Resolution:** Now persists the actual validated booleans (`terms_accepted: termsAccepted, privacy_acknowledged: privacyAcknowledged`). Behavior-preserving today; correct regardless of future guard changes.

### L8 — Approval bearer token in URL fragment: residual browser-history/extension exposure (PLAUSIBLE)
**`website/quick-approve-trial/quick-approve.js:9`**

The fragment + `replaceState` + `no-referrer` + POST-body pattern is correct and the token is stripped from the address bar before any request. Residual: a browser extension or the brief pre-`replaceState` window could read it; the token grants both PII read and approval.

**Actionable insight / resolve:** Accept and document the residual, or reduce it — keep the TTL as short as viable and consider splitting low-sensitivity `preview` from a `confirm` that requires an extra authenticated admin step. Do **not** move the token to the query string.

### L9 — QA auto-login: plaintext password via deep-link query param + `__DEV__`-only gate + native module in prod deps (CONFIRMED)
**`app/auth-landing.tsx:273-330`, `package.json:87`** *(consolidates 4 findings)*

The new effect reads `qaLogin/qaLoginEmail/qaLoginPassword` from `useLocalSearchParams` **and** `react-native-launch-arguments`, then calls `signInWithPassword`. Gated by `if (!__DEV__ ...) return`, so dead in release. Two residuals: (1) a password passed via URL query param is exposed to Android logcat / deep-link intent logging / screen recordings on dev builds; (2) the gate is `__DEV__` alone with no test-account allowlist and no redundant flag.

**Actionable insight:** Never carry the secret over a URL; add a redundant runtime gate so a misconfigured build can't activate it.

**How to resolve:** Drop `params.qaLoginPassword` (accept the password only via `LaunchArguments`, which isn't logged as an intent URI); wrap the effect in `if (!__DEV__ || !isQaLoginEnabled()) return` where `isQaLoginEnabled()` reads an `EXPO_PUBLIC` flag unset in the preview/production `eas.json` env blocks; optionally allowlist test-account email domains. Keep the `__DEV__` guard as the first statement (a CI lint that `LaunchArguments` usage stays behind `__DEV__` would prevent future exposure). The native module shipping in release is harmless on its own.

### L10 — `stripEndingPunctuation` strips `!`/`?` (not just `.`) and can empty a name (CONFIRMED)
**`lib/deal-offer-contract.ts:331,606,621,705`** *(consolidates 3 findings)*

The new `stripEndingPunctuation(value) = cleanText(value).replace(/[.!?]+$/g, "")` is applied to location/merchant names to avoid a duplicated appended period. But it also strips a trailing `!`/`?` from a legitimate name, a punctuation-only name collapses to empty → `"Redeem only at ."`, and the same raw name still flows unstripped through `redeemAtLocationName`. Deal facts are authoritative — copy generation shouldn't silently alter a merchant's chosen name.

**Actionable insight:** Strip only the character that duplicates (the period), and fall back to the original name if stripping empties it.

**How to resolve:** Use `replace(/\.+$/g, "")` (or de-dupe terminal punctuation with `replace(/([.!?])\1+/g,"$1")` after assembly); `const location = stripEndingPunctuation(locationName) || locationName;`. Ideally normalize once in `canonicalLocationName` so all consumers inherit it. **Note:** `AdAccessibilityText.tsx` mirrors this logic and is AI-core-locked — see I-AI below; flag before editing.

### L11 — New offer-terms regression test covers only the BOGO path (CONFIRMED)
**`lib/offer-definition.test.ts:140`**

The identical punctuation change to the **percent-off** builder has no test. **Resolve:** add a `PERCENT_OFF` case with `locationName: "Bluebird Coffee Co."` asserting `"Redeem only at Bluebird Coffee Co."` and not `"Co.."`.

### L12 — QA auto-login duplicates the real login sequence and will drift (CONFIRMED)
**`app/auth-landing.tsx:298`**

The effect re-implements resolve-role → adopt-role → resolve-href → replace (plus the email-not-confirmed branch + telemetry). **Resolve:** extract a `completeLogin(signInData, {nextParam, logLabel})` helper both the normal handler and the QA effect call, so behavior can't silently diverge.

### L13 — `google-services` plugin `apply` relocated in `build.gradle` (CONFIRMED)
**`android/app/build.gradle:144`**

The `apply plugin: 'com.google.gms.google-services'` line moved from bottom-of-file to just after the `android {}` block. **No** version/signing/package change (so no hard-gate tripped), but it's an unexplained change inside a hard-gated file that `expo prebuild` could regenerate away. **Resolve:** record why it moved (did it fix a build-order error?) in the branch/QA notes, or revert to conventional placement if incidental.

---

## INFO (hardening notes & positives)

- **I-CORS** `admin-business-applications/index.ts:79` — `getCorsHeaders` is origin-cosmetic and is **not** an access control for the unauthenticated quick actions; token secrecy/TTL/single-use/logging carry the full burden. Doc/threat-model note only.
- **I-BEARER** `index.ts:649` — quick-approval consumption is a pure bearer capability on a `verify_jwt=false` endpoint (accepted magic-link model). Optional hardening: bind redemption to an additional signal (admin session or secondary code).
- **I-HONEYPOT** `submit-business-application/index.ts:277` — a tripped honeypot returns `{ok:true}` while a real success returns `{ok:true, onboarding_saved:true}`; the shapes differ, letting a bot detect the honeypot. **Resolve:** return the identical body.
- **I-EMAILURL** `admin-alert-email.ts:102` — `escapeHtml` doesn't validate the `href` scheme; safe only because `quickApprovalUrl` is fully server-constructed. Optional: only render the button when the URL `startsWith("https://")`.
- **I-REFERRER** `website/vercel.json:53` — two matching header blocks both set `Referrer-Policy`; effective value is order-dependent. Explicit `<meta>` already present. Doc note / keep block order.
- **I-SCRIPTLOAD** `quick-approve.js:13` — the token stays in the address bar if the script is blocked before `replaceState`. No fix without `unsafe-inline` (worse tradeoff). Accept.
- **I-ONBOARDING** `app/onboarding.tsx:253` — the primary CTA moved from a sticky footer into `ScrollView` content, so it's no longer always visible. Confirm with design; verify on S10 with ZIP keyboard open + large a11y fonts. Prune now-unused `scrollPadding`/`minHeight` in `getStackFooterMetrics` if kept.
- **I-AI** `components/composed-ad-card/AdAccessibilityText.tsx:7` — behavior change (`sentencePart` punctuation strip) inside the **AI-core-locked** directory with no lock-manifest entry. **Per CLAUDE.md this needs Dan's explicit per-file approval.** Record an approval ref (mirroring the `deal-offer-contract.ts` entry) and add the file to `docs/ai-poster-core-lock.json` with its hash, or document why it's excluded.
- **I-GATE1** `scripts/check-website-supabase-readiness.js:458` — the new quick-approval assertions are **string-presence** checks; they give false confidence that the security control works. Back the real invariants (invalid/expired/reused token → HTTP 410; confirm re-checks status/tier/verification/risk) with behavioral tests in the existing Deno `*-source.test.ts` files; keep grep as a tripwire.
- **I-GATE2** `scripts/check-website-ui-crawl.js:402` — the crawl **mocks** `quick_preview`/`quick_confirm`, so no negative-path (invalid/expired/reused) behavior is exercised. Add a mock variant returning `410` and assert the page shows the unavailable message and does **not** reveal the result panel; assert `location.hash` is empty after load.
- **I-FIXTURES** `lib/screenshot-fixtures.ts:82` — new fixtures carry redundant dual-representation fields (`start_time` vs `starts_at`, etc.) that can silently drift. Derive the duplicates from one source and non-null-assert the business lookup so a bad id fails fast.
- **I-I18N (positive)** `website/localization.js:516` — `quickApproval.*` strings are complete across en/es/ko. No gap. ✅

---

## Recommended priority order

1. **M1 + M2** — fix the public intake rate limiter (trusted client IP + atomic check). Highest real-world exposure (cost/abuse on an unauthenticated endpoint).
2. **L1 + L2** — L1 is now LOW given the single-access `support@` inbox (see Operator context): the action item is **hardening the `support@` email account itself** (phishing-resistant MFA, no forwarding), not a code change. Still worth doing: audit `quick_preview` (L2). Cheap, closes the observability gap.
3. **L6/L7/L10** — de-forge `verified_low_risk`, persist real consent, narrow the punctuation strip (deal-fact integrity).
4. **I-AI** — get Dan's per-file approval + lock entry for `AdAccessibilityText.tsx` before this branch merges (project rule).
5. Everything else — batch as hardening/observability follow-ups.

*Full per-finding verifier reasoning and failure scenarios: workflow run `wf_942b7401-da9`.*
