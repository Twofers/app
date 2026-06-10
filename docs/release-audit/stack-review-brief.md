# Reviewer's brief — `fix/business-locations-keying` stack

**Range:** `2c69987..06c129d` (inclusive). Note: this is **13 commits**, not 12 — the range from `2c69987` through `06c129d` inclusive contains thirteen commits. All are local-only; nothing in this stack has been pushed, and none of the migrations it adds have been applied to the remote database. None of the modified edge functions have been redeployed yet either — the deployed versions still run the pre-stack code.

Commits are listed oldest-first, the order you'd review them in.

---

## 1. `2c69987` — Key business_locations by businesses.id, not business_profiles.id

**Files:** `hooks/use-business-locations.ts` (+4 / −33)

**What and why.** The `useBusinessLocations` hook was resolving a `business_profiles` row id and then reading and auto-creating `business_locations` rows keyed by that id. But the schema, the backfill, and `deals.location_id` all key locations by `businesses.id`. The mismatch meant any location row the owner edited through this hook was an orphan no deal ever pointed at. Since `useBusiness()` already supplies `businesses.id`, the whole profile-lookup detour is deleted and the read and the auto-create insert use `businessId` directly.

**Riskiest part.** The auto-create path: if the keying change is wrong in either direction, an owner could end up with a *second* location row (one profile-keyed orphan, one businesses-keyed) or with no row at all, and the edit screen would show stale or blank location data.

**What to check.** Confirm both the `.eq("business_id", ...)` read filter and the insert payload now use the `businessId` parameter, that nothing in the hook still imports or queries `business_profiles`, and that the auto-create only fires when the read returns zero rows. The two pre-existing orphan rows in prod are deliberately *not* cleaned up here — that's deferred SQL (next commit).

---

## 2. `7a21249` — Document deferred business_locations SQL

**Files:** `docs/deferred-supabase-steps.md` (+135, new file)

**What and why.** Documentation only — no code or schema change. It writes down the two Supabase-side steps deliberately deferred until the next build ships: rewriting the `business_locations` INSERT cap policy to be keyed by `businesses.id`, and deleting the two orphan profile-keyed location rows. It includes pre-checks and post-checks so whoever runs it can verify state before and after.

**Riskiest part.** Only that the SQL written down could be wrong when eventually run. Nothing executes now.

**What to check.** Read the SQL as if you were about to run it: the cap-policy `WITH CHECK` should count rows per `businesses.id`, and the orphan delete should target exactly the two known profile-keyed row ids with a guard (not a broad pattern delete).

---

## 3. `104057d` — Batch 1: AI limit reductions (item 4) and reuse.tsx color fix

**Files:** `app/create/ai.tsx` (±1), `app/create/reuse.tsx` (±2), `supabase/functions/ai-generate-ad-variants/index.ts` (±2), `supabase/functions/ai-generate-deal-copy/index.ts` (±1)

**What and why.** Implements decided open item 4: the client soft revision cap drops from 5 to 2 (`SOFT_REVISION_CAP` in `ai.tsx`), the server hard cap drops from 10 to 2 (`MAX_REVISION_COUNT` in ai-generate-ad-variants), and the deal-copy monthly default drops from 60 to 30 (still overridable via the `AI_COPY_MONTHLY_LIMIT` env var). Separately it fixes a real rendering bug in `reuse.tsx`: two `color` props were the literal string `"theme.primary"` instead of the variable `theme.primary`, so those texts rendered in the default color.

**Riskiest part.** Client soft cap and server hard cap are now the same number (2). Previously the server cap (10) had headroom over the client cap (5), so a client/server counting desync was invisible. Now any off-by-one between how the client counts revisions and how the server counts them would surface as a hard server rejection on what the user believes is their last allowed revision.

**What to check.** Trace how `revisionCount` is incremented client-side versus how `MAX_REVISION_COUNT` is compared server-side (`>=` vs `>`), and confirm both count the same events (revisions, not initial generations). Also note this commit touches two edge functions that the next commit rewrites heavily — see the overlap section.

---

## 4. `f5994ad` — Batch 2: hard role split and demo code removal (item 2)

**Files:** 41 files, +416 / −2,932. Highlights: `app/auth-landing.tsx` (−~200 net), `app/(tabs)/account.tsx` (−~250 net), `lib/tab-mode.tsx` (rewritten), `lib/profiles-role.ts` (+70, new), `lib/profiles-app-mode.ts` (deleted), `lib/demo-preview-seed.ts` / `lib/demo-account.ts` / `lib/demo-auth-signin.ts` / `scripts/seed-demo.cjs` / `supabase/seed_demo_coffee_business.sql` / `ai-generate-ad-variants/demo-variants.ts` (all deleted), 7 edge functions stripped of demo branches, new migration `20260711120000_profiles_role.sql`, locale files, `eas.json`, `package.json`.

**What and why.** This is the big one — it implements decided item 2. The role is now picked once at signup, stored in `profiles.role`, and login routes by it with no picker; for existing accounts a derive fallback applies (owns a `businesses` row → business, else customer). The soft switchable `profiles.app_tab_mode` model (`lib/profiles-app-mode.ts`, the Settings switch path) is removed and `lib/tab-mode.tsx` is rewritten around the locked role. In parallel, every `demo@demo.com` code path is deleted: the demo login helper, the demo preview seed, the seed scripts, and the canned/demo branches inside seven AI edge functions. The migration adding `profiles.role` is written but **not applied** — until it is, every account goes through the derive fallback.

**Riskiest part.** Login routing for existing accounts while the migration is unapplied. If `lib/profiles-role.ts` mishandles the missing-column error (versus a null value), real users could be routed to the wrong side or stuck at login. Second risk: the demo strip touched seven edge functions — deleting a demo branch can accidentally delete shared logic next to it (this actually happened once; see the next commit).

**What to check.** Read `lib/profiles-role.ts` end to end: how it behaves when the `role` column doesn't exist yet, the derive query (`businesses` ownership), and how the result is cached/cleared on sign-out (`clearCachedRole`). In `tab-mode.tsx`, confirm there is no remaining path that lets a user flip sides. In the edge function diffs, check each demo-branch deletion removed only the `if (isDemo...)` arm and not surrounding logic. Grep for any surviving imports of the deleted modules (`demo-account`, `demo-auth-signin`, `demo-preview-seed`, `profiles-app-mode`). Finally, read migration `20260711120000_profiles_role.sql` — it must be additive (new column, backfill) with no destructive statements.

---

## 5. `3f0ead8` — Batch 2b: functions typecheck gate fix and auth screen es/ko translations

**Files:** `scripts/typecheck-functions.cjs` (+9 / −1), `supabase/functions/ai-generate-ad-variants/index.ts` (+3), `lib/i18n/locales/es.json` (+4), `lib/i18n/locales/ko.json` (+4)

**What and why.** Cleanup after Batch 2. The functions typecheck script used to bail on the first failing file, which could hide additional failures; it now checks every file and reports all failures together. In ai-generate-ad-variants it restores an `isRevision` definition (`previousAd !== undefined`) — Batch 2's demo strip removed the line that defined it while later code still used it, which is exactly the "deleted shared logic next to a demo branch" failure mode. It also adds the Spanish and Korean translations for the new auth-landing "polished" subtitle and role-hint strings that Batch 2 introduced in English only.

**Riskiest part.** The `isRevision` restoration: it's a semantic claim (`previousAd` is only passed on revision calls) that must actually match how the handler calls `generateCopy`.

**What to check.** In ai-generate-ad-variants, find every call site of `generateCopy` and confirm `previousAd` is passed if and only if the request is a revision, then find where `isRevision` is consumed and confirm the behavior matches pre-Batch-2 logic. Spot-check that the four es/ko keys exactly mirror the en.json keys Batch 2 added (same key names, no missing interpolations).

---

## 6. `2d532cf` — Batch 3: confirmation email resend and unconfirmed-login error mapping

**Files:** `app/auth-landing.tsx` (+80 / −1), `lib/auth-error-messages.ts` (+12), `lib/i18n/api-messages.ts` (+3 / −1), `en.json` / `es.json` / `ko.json` (+5 each)

**What and why.** Two app-side hardening pieces for the email-confirmation flow (item 6 says confirmation stays on; Dan configures the Supabase side later). First, when a login fails *only* because the email is unconfirmed, the user now sees a correct "confirm your email" message instead of the misleading "wrong email or password" — a new `isEmailNotConfirmedError()` helper plus a mapping that pulls "Email not confirmed" out of the invalid-credentials pattern bucket in `api-messages.ts`. Second, the auth screen gains a resend-confirmation-email action (via `supabase.auth.resend()`) so a user whose original email never arrived isn't dead-ended.

**Riskiest part.** Error-string matching. The detection relies on Supabase's message text ("email not confirmed") and error code (`email_not_confirmed`); if Supabase returns a different shape in some path, the user falls back to the generic credentials error — annoying but safe. The worse direction would be a false positive that tells an attacker a given email exists; the match strings are specific enough that this looks unlikely, but it's the thing to convince yourself of.

**What to check.** In the `auth-landing.tsx` diff, look at when the resend action becomes visible (it should only appear after an unconfirmed-login failure, not on every error), whether resend taps are debounced or guarded against Supabase's resend rate limit, and what message a 429 from resend produces. In `api-messages.ts`, confirm the new `email not confirmed` pattern is ordered *before* the invalid-credentials pattern so it wins.

---

## 7. `0b09767` — Batch 4: wire purge_user_data and storage cleanup into account deletion

**Files:** `supabase/functions/delete-user-account/index.ts` (+60), `app/(tabs)/account.tsx` (+2 / −15)

**What and why.** The `purge_user_data` RPC existed in the database but nothing called it (a gap-audit finding), so account deletion left anonymization and user-only-table cleanup undone, and storage objects (business logos, deal photos) leaked forever. The edge function now, before the auth delete: captures owned business ids, calls `purge_user_data`, and on purge failure falls back to directly nulling `app_analytics_events.user_id`; then it best-effort deletes storage objects under each owned business's prefix in both buckets. Every new step logs and continues on failure so cleanup problems can never block the deletion itself. The account screen drops the now-dead "business owners are blocked from deleting" client branch (the server-side block was removed earlier as a documented store-rejection trigger).

**Riskiest part.** Ordering and partial failure in an irreversible flow. The business-id capture, purge, and storage cleanup all run *before* `auth.admin.deleteUser`; if any of them threw instead of logging, the user would get an error with their account still intact (recoverable), but the design intent — cleanup failures never block deletion — depends on every branch swallowing its error. Also, the fallback in this commit writes `session_id: null` to `app_analytics_events`, a column that doesn't exist, so the fallback's first attempt always errors and relies on its own retry — messy, and fixed two commits later.

**What to check.** Walk the new block in `delete-user-account/index.ts` and verify no code path between the start of cleanup and `deleteUser` can throw uncaught or `return` early. Note the storage `list` uses `limit: 1000` with no pagination — fine at pilot scale, a silent truncation later. In `account.tsx`, confirm only the blocked-owner branch was removed and the remaining error handling still routes through `translateKnownApiMessage`.

---

## 8. `2314462` — Batch 5: minimum business notifications (new claim, sold out)

**Files:** `supabase/functions/claim-deal/index.ts` (+74), `supabase/functions/_shared/owner-claim-push.ts` (+86, new), `supabase/functions/_shared/owner-claim-push.test.ts` (+122, new), `supabase/migrations/20260713120000_business_claim_notifications.sql` (+26, new), `app/(tabs)/account.tsx` (+69), locale files (+2 each)

**What and why.** Implements the spec 11.8 minimum: when a consumer claims a deal, the owner gets a push — "new claim" (suppressed to at most one per deal per 10 minutes) or "sold out" (when the claim count hits `max_claims`). It's entirely server-side inside claim-deal so it can't be spoofed, localized via `businesses.preferred_locale`, deep-links to `/dashboard`, and is gated by a new owner opt-out toggle (`businesses.claim_notifications_enabled`, default on) added to the Account screen. The decision logic lives in a pure, unit-tested shared module (`owner-claim-push.ts`). The migration adding the two columns is written but **not applied** — until then the select inside the push block errors on the missing column and the catch keeps the whole feature inert.

**Riskiest part.** This adds several queries and an external push call to the hot claim path. It's all inside one `try/catch` and runs *after* the claim succeeds, so the claim itself should be safe — but it does add latency to the success response, and the "inert until migration" guarantee rests entirely on the missing-column select erroring into the catch rather than returning a row with an undefined field.

**What to check.** Confirm the push block sits after the claim insert/response data is finalized and that nothing in it can alter the success response. Verify the inert claim: a select naming `claim_push_last_sent_at` against a schema without that column returns a Supabase *error* (the code reads `pushRow?` optionally — check the error path actually skips, since `{ data: pushRow }` with an error gives `pushRow = null`, which the `if (pushRow && ...)` guard handles). Review `decideOwnerClaimPush` and its test for the suppression-window edge cases (exactly 10 minutes, null `lastClaimPushAtMs`, sold-out taking priority over new-claim). Note the suppression timestamp is written *before* the send — a crash between write and send drops one push, which is the right failure direction. In the migration, the column-level `GRANT SELECT (claim_notifications_enabled)` matters because an earlier migration replaced the table-level grant; confirm the Account-screen toggle reads/writes through paths the grants permit.

---

## 9. `aa0ef7e` — Batch 4b: corrective migration for purge_user_data (session_id never existed)

**Files:** `supabase/migrations/20260714120000_fix_purge_user_data_columns.sql` (+57, new), `supabase/functions/delete-user-account/index.ts` (+15 / −12... net simplification), `scripts/probe-analytics-schema.mjs` (+87, new)

**What and why.** Follow-up to Batch 4 after probing the live schema: the deployed `purge_user_data` function references an `app_analytics_events.session_id` column that has never existed, so the RPC likely fails on every call. This commit adds a corrective migration that recreates the function without the phantom column, a read-only probe script (`probe-analytics-schema.mjs`) that documents how the schema was verified, and simplifies the edge function's fallback: the awkward two-step "try with session_id, retry without" from Batch 4 becomes a single clean `update({ user_id: null })`.

**Riskiest part.** The migration redefines a `SECURITY DEFINER`-style purge function — getting a column or table name wrong there means account deletion silently stops purging something. It's also unapplied, so until it runs, deletion still depends on the edge function's fallback path.

**What to check.** Diff the new function body in `20260714120000_fix_purge_user_data_columns.sql` against the original `20260705120008_purge_user_data_rpc.sql`: the *only* difference should be removing `session_id` references — same tables, same anonymize-vs-delete split. Confirm `probe-analytics-schema.mjs` is genuinely read-only and contains no embedded secrets. In the edge function, confirm the simplified fallback still only runs when `purgeErr` is set.

---

## 10. `3332b75` — Batch 6: redeem lockout, CSPRNG share codes, share lookup hardening

**Files:** `supabase/functions/redeem-token/index.ts` (+54), `supabase/migrations/20260715120000_share_lookup_hardening.sql` (+189, new), `lib/share-deal.ts` (+7 / −1), `package.json` / `package-lock.json` / `deno.lock` (expo-crypto dependency)

**What and why.** Three security hardenings from the audit. (1) redeem-token gets a brute-force lockout: failed redemption attempts (unknown code, wrong business, expired) are logged to the existing `failed_redeem_attempts` table, and 10+ failures in 5 minutes for a business (scoped to IP when one is available) returns 429 before any code lookup. (2) Client share-code generation switches from `Math.random()` (guessable) to `expo-crypto` CSPRNG bytes, same alphabet and length so existing codes stay valid. (3) The migration hardens Share Deal server-side: the anon-callable `lookup_deal_share` RPC throttles its `opened_count` bump to once per 30 seconds per share row (so visitors can't spam-inflate a sender's counter, while the preview itself still renders), and the `deal_shares` insert policy now only lets senders mint codes for live deals instead of any deal id.

**Riskiest part.** The lockout can hit legitimate owners: when no client IP header is present the count is business-wide, so a staffer fat-fingering codes 10 times locks redemption for the whole business for up to 5 minutes during service. Also `expo-crypto` is a new native dependency — it does nothing until the next app build, and the build must include it.

**What to check.** In redeem-token, confirm failures are recorded with the service-role client (the table is RLS default-deny), that `recordFailedAttempt` can never throw out of its own try/catch, and that a lockout *check* failure fails open (logs and continues) rather than blocking redemption. Decide whether the no-IP business-wide scope is acceptable for the pilot. In the migration, diff `lookup_deal_share` against `20260710120000_deal_shares.sql` — outside the throttled-UPDATE-then-reread logic the body should be identical, and the grants (`REVOKE FROM PUBLIC`, `GRANT TO anon`) preserved. In `share-deal.ts`, note the modulo over a 31-character alphabet has negligible bias (documented in the comment).

---

## 11. `f68fc2c` — Batch 7: feed quantity, pre-rendered claim states, directions links

**Files:** `app/deal/[id].tsx` (+94 / −~9), `app/(tabs)/index.tsx` (+51), `app/(tabs)/wallet.tsx` (+35), `lib/directions.ts` (+73, new), `supabase/migrations/20260716120000_deal_claim_counts_rpc.sql` (+30, new), locale files (+7 each)

**What and why.** Three consumer UX gaps. (1) The feed shows an "Only N left" scarcity cue on capped deals with 1–5 claims remaining. Because `deal_claims` RLS only lets a user see their own claims, a client-side count was always wrong, so this is fed by a new aggregate-only `SECURITY DEFINER` RPC, `deal_claim_counts`, that returns counts (never rows or user ids) for up to 200 deal ids. (2) The deal detail screen pre-renders sold-out / closed / not-yet-started states before the user taps Claim, with sold-out gated on the RPC count being available (`claimsCountReliable`) so the unreliable own-claims-only fallback can never falsely show sold out. The server checks in claim-deal stay authoritative. (3) A shared `lib/directions.ts` helper (extracted from the business profile screen's pattern) adds "Directions" links to the wallet and deal detail, preferring coordinates, falling back to a name+address query, native maps URL then Google Maps web, never throwing.

**Riskiest part.** The new RPC: any authenticated user can now query claim counts for arbitrary deal ids. It's aggregate-only by construction, but it does reveal a deal's popularity to anyone, and as `SECURITY DEFINER` it bypasses RLS — the function body is the entire security boundary.

**What to check.** Read the RPC: it must select *only* `deal_id, claim_count`, filter `claim_status IS DISTINCT FROM 'canceled'` (matching claim-deal's cap counting — if these ever diverge, the feed says "only 1 left" while the server says sold out, or vice versa), bound the array to 200, and grant execute to `authenticated` only. In `index.tsx`, note the count-fetch effect re-runs on every `deals` change — fine at pilot scale. In `deal/[id].tsx`, confirm `claimsCountReliable` is only set on RPC success and that the pre-rendered block never replaces the server as the authority. In `directions.ts`, check the URL building can't produce an unencoded-injection into `Linking.openURL` (everything user-derived goes through `encodeURIComponent` on the query path; the coordinate path interpolates only validated numbers).

---

## 12. `7a5ed1c` — Batch 7b: remove dead delete-account-blocked handling

**Files:** `lib/functions.ts` (−14), `en.json` / `es.json` / `ko.json` (−3 each)

**What and why.** Pure dead-code removal. The server-side "business owners can't delete their account" block was removed from the delete-user-account edge function earlier (it was a documented App Store rejection trigger), and Batch 4 (`0b09767`) removed the Account-screen UI that handled the blocked case. That left `DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER` and its body-sniffing throw helper in `lib/functions.ts` with no consumer, plus three orphaned i18n keys per locale. This deletes all of it.

**Riskiest part.** Minimal — deleting an exported constant could break a remaining importer, but `0b09767` already removed the only one.

**What to check.** Grep the repo for `DELETE_ACCOUNT_BLOCKED_BUSINESS_OWNER` and for the three removed i18n keys (`deleteAccount.businessOwnerBlocked*` / `contactSupportCta` family) — zero hits outside this diff means it's clean. Confirm `deleteUserAccount()` still throws a sensible error for both the `error` and `data.error` shapes.

---

## 13. `06c129d` — Batch 8: reconcile spec with audited code reality

**Files:** `twofer-developer-handoff-spec.md` (+65 / −63)

**What and why.** Documentation only. After Batches 1–7, the spec's "decided but not yet implemented" annotations on items 2 and 4 were stale, so this updates section 4 (role split and AI limits now implemented, with the pending-deploy/pending-migration caveats recorded), the demo-account reference row (code half done in `f5994ad`; the Supabase account deletion remains a hard-gated, sequenced step), and several product sections that the gap audit showed had drifted from the build — e.g. consumer navigation is four tabs with favorites integrated into Home (no Favorites tab), onboarding is two steps with language selection on the auth landing screen, and notification consent is deliberately deferred to the first-favorite moment rather than an onboarding step.

**Riskiest part.** A wrong claim in the spec misleads future work — particularly anything marked "IMPLEMENTED" that isn't, since the repo rule is "code wins, report conflicts."

**What to check.** Spot-check the strongest claims against the code: item 2 "IMPLEMENTED" → `lib/profiles-role.ts` exists and `lib/profiles-app-mode.ts` is gone; item 4 → the 30/month and 2-regeneration numbers in `104057d`; the scarcity-cue description names the right migration (`20260716120000`). Confirm no locked decision in section 1 was altered.

---

## Cross-commit file overlaps — check these compose

| File | Commits | What to verify |
|---|---|---|
| `supabase/functions/ai-generate-ad-variants/index.ts` | `104057d` → `f5994ad` → `3f0ead8` | Three touches. Batch 1 lowers `MAX_REVISION_COUNT`; Batch 2 strips demo branches (and accidentally deleted the `isRevision` definition); Batch 2b restores it. Review the **final** state of this file, not the per-commit diffs: revision cap = 2, no demo references, `isRevision` defined and used consistently. |
| `supabase/functions/ai-generate-deal-copy/index.ts` | `104057d` → `f5994ad` | Batch 1 changes the monthly-limit default; Batch 2 deletes demo branches in the same file. Confirm the 30/month default survived the Batch 2 deletions. |
| `app/create/ai.tsx` | `104057d` → `f5994ad` | Batch 1 sets `SOFT_REVISION_CAP = 2`; Batch 2 removes demo paths (−10 lines). Confirm the cap constant and its usage survived. |
| `app/(tabs)/account.tsx` | `f5994ad` → `0b09767` → `2314462` | Three touches: Batch 2 guts the demo/switch UI (−250), Batch 4 removes the blocked-owner delete branch, Batch 5 adds the claim-notifications toggle (+69). Read the final file once: deletion flow, the new toggle, and role display must all coexist with no orphaned imports or unused i18n keys. |
| `app/auth-landing.tsx` | `f5994ad` → `2d532cf` | Batch 2 rewrites the screen (signup-only role picker); Batch 3 layers the resend-confirmation flow on top (+80). Confirm the resend logic integrates with the rewritten login handler, not a stale copy of the old one. |
| `lib/auth-error-messages.ts` | `f5994ad` (−12) → `2d532cf` (+12) | Batch 2 removed demo-related error mapping; Batch 3 added the email-not-confirmed mapping. Equal line counts are coincidence — verify nothing Batch 3 added depends on anything Batch 2 removed. |
| `lib/i18n/api-messages.ts` | `f5994ad` → `2d532cf` | Batch 2 removed a demo line; Batch 3 re-bucketed "Email not confirmed" out of the invalid-credentials pattern. Check pattern ordering in the final file. |
| `lib/functions.ts` | `f5994ad` (−60) → `7a5ed1c` (−14) | Two rounds of deletion (demo invoke helpers, then blocked-owner handling). Confirm the surviving exports compile and nothing imports the removed ones. |
| `supabase/functions/delete-user-account/index.ts` | `0b09767` → `aa0ef7e` | Batch 4 adds purge + storage cleanup; Batch 4b simplifies the analytics fallback. Review the final file: exactly one fallback update, no `session_id` reference anywhere. |
| `package.json` | `f5994ad` (removes `seed:demo` script) → `3332b75` (adds `expo-crypto`) | Independent changes; just confirm both landed. |
| `lib/i18n/locales/en.json` / `es.json` / `ko.json` | `f5994ad`, `3f0ead8` (es/ko only), `2d532cf`, `2314462`, `f68fc2c`, `7a5ed1c` | Six commits each add/remove keys. Run whatever locale-parity check exists (or diff key sets) on the final files: every key present in all three locales, no orphaned keys left from the deletions. |

---

## Migrations added by this stack (all written, **none applied**)

| File | What it does |
|---|---|
| `supabase/migrations/20260711120000_profiles_role.sql` | Adds `profiles.role` for the hard Shopper/Business role split (Batch 2); until applied, the app derives role from `businesses` ownership. |
| `supabase/migrations/20260713120000_business_claim_notifications.sql` | Adds `businesses.claim_notifications_enabled` (owner toggle, default on, with column-level SELECT grant) and `deals.claim_push_last_sent_at` (10-minute new-claim push suppression window). |
| `supabase/migrations/20260714120000_fix_purge_user_data_columns.sql` | Recreates `purge_user_data` without the phantom `app_analytics_events.session_id` reference that made the deployed RPC fail. |
| `supabase/migrations/20260715120000_share_lookup_hardening.sql` | Throttles `lookup_deal_share`'s anonymous `opened_count` bump to once per 30s per share, and restricts the `deal_shares` insert policy to live deals only. |
| `supabase/migrations/20260716120000_deal_claim_counts_rpc.sql` | Adds the aggregate-only `deal_claim_counts(uuid[])` SECURITY DEFINER RPC (counts only, max 200 ids, `authenticated` only) for the scarcity cue and pre-rendered sold-out states. |

Applying any of these is a hard gate (Dan approves).

## Edge functions modified by this stack (none redeployed yet)

- `ai-compose-offer` — demo paths removed (`f5994ad`)
- `ai-create-deal` — demo paths removed (`f5994ad`)
- `ai-deal-suggestions` — demo paths removed (`f5994ad`)
- `ai-extract-menu` — demo paths removed (`f5994ad`)
- `ai-generate-ad-variants` — revision cap 10→2 (`104057d`), demo paths + `demo-variants.ts` removed (`f5994ad`), `isRevision` fix (`3f0ead8`)
- `ai-generate-deal-copy` — monthly default 60→30 (`104057d`), demo paths removed (`f5994ad`)
- `ai-translate-deal` — demo paths removed (`f5994ad`)
- `claim-deal` — owner new-claim/sold-out pushes added, inert until migration `20260713120000` is applied (`2314462`); also gains new shared module `_shared/owner-claim-push.ts` (+ tests)
- `delete-user-account` — purge_user_data + storage cleanup wired in (`0b09767`), fallback simplified (`aa0ef7e`)
- `redeem-token` — brute-force lockout via `failed_redeem_attempts` (`3332b75`)

Deploy sequencing reminder: the demo-stripped versions of the AI functions are part of the demo-teardown plan, which is sequenced after the reviewer accounts are live — don't redeploy them ad hoc. `claim-deal`'s push feature additionally needs its migration applied first (it degrades safely without it, but redeploying before the migration just ships inert code).
