# Twofer Codebase Gap Audit

> Historical audit only. This document was written before the role-split and AI-limit batches
> landed, so several findings below are no longer current. Use the repo-root
> `twofer-developer-handoff-spec.md` plus a fresh audit of the current HEAD for release work.

Date: 2026-06-10 · Branch: `docs/section4-confirmations` (HEAD `ac29c1b`) · Read-only audit, no code changed.

Spec audited against: `twofer-developer-handoff-spec.md` at the **repo root** (the task prompt said `docs/`, but the spec lives at the root per CLAUDE.md). Four parallel sub-audits: A = Consumer (spec 10.1–10.10), B = Business (11.1–11.8), C = Architecture & AI (8, 12, 15), D = Data/Security/Integrations (13, 14, 17, 18, 19).

Per spec section 4, all six former open items were decided by Dan on 2026-06-10. Items 2 (hard role split + demo deletion) and 4 (AI limits 30/month, 2 regens) are **decided but not yet implemented**; everywhere the code still shows the old behavior, that is marked ⚠️ "decided, pending implementation," not ❌.

## Summary

- **Total features reviewed: 39**
- **Working: 20 · Partial: 18 · Broken: 0 · Not Built: 1**
- **Critical path (MVP claim-to-redeem): FUNCTIONAL end to end.** Feed → deal detail → claim (server-enforced limits, unique token + short code) → QR/wallet → business scan or manual code → idempotent redeem with expiry/grace. The ⚠️ items on this path (feed quantity display, deal-detail claim-state pre-rendering, wallet directions link) are polish, not breaks.
- **Blockers to TestFlight / store submission:**
  1. `app_analytics_events_backup_20260708` table has no RLS/REVOKE — a likely anon-readable snapshot of user analytics in production (privacy exposure; fix is Supabase-side, hard-gated).
  2. Production schema drift: migrations add `deals.location_id` but a hosted probe previously proved prod lacks it (42703) — migrations are ahead of the live DB.
  3. Universal links / share preview: the `/s/<code>` page, AASA file, and assetlinks.json live in the website repo and are not deployed from here — `applinks:www.twoferapp.com` won't verify until the website side ships.
  4. Decided-but-pending items 2 and 4 (role lock + demo deletion; AI limit reductions) — Dan said these must land; they are app-code work.
  5. Email confirmation UX: no resend path, and an unconfirmed-login error surfaces as "wrong email or password."
  None of these is a crash or a dead feature; the app itself is coherent.

---

## Working (✅)

### Consumer (Agent A)
| Feature | Where | Note |
|---|---|---|
| Map & location discovery (10.3) | `app/(tabs)/map.tsx:15-37`, `components/map/map-native-screen.tsx` | Live-deal halo markers, All/Live toggle, radius circle, DFW fallback + Settings CTA, explicit no-crash permission paths. |
| Claim flow (10.5) | `app/(tabs)/index.tsx:514-583`, `app/deal/[id].tsx:248-290`, `supabase/functions/claim-deal/index.ts:407-600` | One active claim app-wide (idempotent same-deal), one per business per local day, max-claims, unique token + 6-char short code with collision retry, redeem-by reminder scheduled. |
| QR display & consumer redemption (10.6) | `components/qr-modal.tsx:111-464`, `app/(tabs)/wallet.tsx:318-384` | Live countdown, ACTIVE/EXPIRED pill, expired QR blanked, slide-to-confirm visual redeem with stale-redeem finalization. |
| Favorites (10.8) | `app/(tabs)/index.tsx:486-512`, `app/onboarding.tsx:143-148`, `app/(tabs)/settings.tsx:559-572` | Optimistic toggle with rollback, favorites-first feed sort, favorites-only notification mode. (No dedicated Favorites tab — integrated into Home; code wins.) |
| Share Deal — consumer side (14) | `lib/share-deal.ts:42-127`, `app/deal/[id].tsx:534-544`, `eas.json:26,39,51`, `lib/runtime-env.ts:107-109` | Flag set in all three profiles, read in exactly one place (matches decided item 3). Reused 7-char safe code, native share sheet, no tokens in share text, `/s/` inbound handling. |
| Reporting (10.10) | `components/report-sheet.tsx:94-235`, `lib/reports.ts:44-58`, migration `20260705130000_reports.sql:60` | Reason list + optional comment, iOS keyboard handled, Android back closes, `report_business`/`report_user` RPCs. |

### Business (Agent B)
| Feature | Where | Note |
|---|---|---|
| Business profile setup + AI lookup fix | `lib/business-lookup.ts:32-66`, `lib/functions.ts:374-435`, `app/business-setup.tsx:262-329`, `supabase/functions/ai-business-lookup` | Google Places only; non-`google_places` rows rejected; owner reviews/edits before save. "AI never invents business facts" satisfied, with unit tests. |
| Quick Deal creation | `app/create/quick.tsx:123-357` | Hint/photo → `aiGenerateAd` → editable copy with strong-deal hints → preview → quality + strong-guard → insert; publish push + translation fire-and-forget. (Uses the v2 `ai-generate-ad-variants` pipeline, not the spec's `aiGenerateDealCopy` + poster function — code wins.) |
| AI Compose creation | `app/create/ai.tsx` (photo `:255-261`, voice `:329-334`, quota `:337-351`, generate/revise `:1138-1210`, publish `:1226-1412`) | Full unified editor incl. save-as-template; `ai-compose.tsx` is a deliberate redirect. Regen caps pending item 4 (see Partial). |
| Dashboard & metrics (11.5) | `app/(tabs)/dashboard.tsx:503-625, 1303-1415`, `lib/merchant-insights.ts:16-44`, `app/deal-analytics/[id].tsx` | Claims/redeems/uniques/conversion/impressions/opens, weekly chart, AI insights, CSV/PDF export, NaN-safe math, honest "what this proves" card. |
| QR scanner & redemption (11.7) | `app/(tabs)/redeem.tsx:32-336`, `supabase/functions/redeem-token/index.ts:156-292` | Camera scan + manual short-code fallback; distinct 403/404/409/410 errors localized; idempotent redeem; post-success report-customer sheet. |

### Architecture & AI (Agent C)
| Feature | Where | Note |
|---|---|---|
| Expo SDK & EAS setup | `package.json:32`, `eas.json:2-60`, `app.json:14-20,250-253` | Expo ~54.0.35 / RN 0.81.5, correct profiles, `supportsTablet:false`, bundle/package ids match spec section 3; demo/debug env vars absent from production profile. |
| Push architecture (15) | `lib/push-token.ts:48-65`, `supabase/functions/_shared/expo-push.ts`, `send-deal-push/index.ts:55-120` | Expo Push Service end to end; no iOS Firebase (`GoogleService-Info.plist` absent); `google-services.json` is Android FCM transport only; server-side opt-in gate before any send. |
| APNs / provisioning references | No `ios/` dir, no tracked credentials | Credentials held remotely by EAS as intended. Actual key/profile validity is **not verifiable from this repo** — needs `eas credentials` (Dan/cloud). |
| Privacy manifest | `app.json:28-178` | `NSPrivacyTracking:false`, 14 collected data types all non-tracking, 4 accessed-API reasons; reconciliation doc `docs/privacy-manifest-reconciliation-20260607.md` maps each type to a real flow. |
| ai-generate-deal-copy | `supabase/functions/ai-generate-deal-copy/index.ts:128-345` | Auth required, strict JSON-schema output, server-side model allowlist, usage logged. (Returns ONE result, not the spec's 2–3 variants with style lanes — spec is stale; and its 60/month cap is the pending item 4.) |
| Voice transcription (decided item 5) | `supabase/functions/ai-compose-offer/index.ts:17-65,309-324,396` | Audio decoded in memory → whisper-1 → discarded; only the transcript (and a 4,000-char hash for dedupe) is stored in `ai_generation_logs`. Matches the decision exactly. |

### Data & security (Agent D)
| Feature | Where | Note |
|---|---|---|
| Device token storage & push delivery | `supabase/migrations/20260402120000_push_tokens.sql`, `lib/push-token.ts:42-65`, `send-deal-push/index.ts:68-104` | Self-scoped RLS, consent-gated registration, owner-authorized sends to opted-in favoriters only, secret-gated digest cron, stale-token cleanup scheduled. |
| Privacy declarations vs store listing (19.5) | `app.json` privacy manifest, `docs/app-store-connect-answer-sheets-20260607.md`, `lib/support-contact.ts:8` | Matches spec 19.5 line-for-line; in-app support email is `support@twoferapp.com` (item 1 — the stale website email is a website-repo task). |
| Deep links / AASA — in-repo half (14.5, 16) | `app.json` (associatedDomains, `/s` intent filter w/ autoVerify), `supabase/functions/deal-link/index.ts`, `lib/share-deal.ts:6` | App-side config correct; QR fallback interstitial HTML-escaped and public-fields-only. Website pieces are out-of-repo (see Not Built / blockers). |

---

## Partial (⚠️)

### Decided 2026-06-10, pending implementation (do not re-decide — just build)
1. **Hard Shopper/Business role split + demo deletion (item 2).** Code still routes by soft `profiles.app_tab_mode` (`lib/tab-mode.tsx:28-46`, `app/index.tsx:65-66`), Settings still offers "Switch to Business" (`app/(tabs)/settings.tsx:622-632`), and demo paths persist (`lib/demo-account.ts`, `lib/demo-auth-signin.ts`, `lib/functions.ts:461-529` demo canned copy, `ai-generate-deal-copy/index.ts:13-92`). Needed: role picked once at signup, login routes by stored/derived role, delete all demo code.
2. **AI usage limits (item 4).** Shared limit is already 30/month (`supabase/functions/_shared/ai-limits.ts:3`), but deal-copy is still 60 (`ai-generate-deal-copy/index.ts:209`), and regen caps are 5 client (`app/create/ai.tsx:232`) / 10 server (`ai-generate-ad-variants/index.ts:42`) vs the decided 2. Three constants to change.

### Consumer
3. **Entry rule (9.4)** — auth-first entry works (`app/index.tsx:39-69`, `components/auth-stack-gate.tsx`); the role-routing half is the soft mode pending item 2.
4. **Onboarding (10.1)** — `app/onboarding.tsx:50-216` covers location/radius/categories/favorites; the spec's notification-permission step doesn't exist — consent is deferred to first-favorite (`app/(tabs)/index.tsx:459-484`) and Settings. Spec/code conflict; code wins, but confirm the deferred-consent design is intended.
5. **Home feed (10.2)** — `app/(tabs)/index.tsx:735-976` hero cards work; two spec deviations: quantity remaining is fetched (`:75`) but never rendered on cards (detail-only, `app/deal/[id].tsx:513-515`), and there is no generic-photo fallback — a branded "Photo coming soon" placeholder instead (`lib/deal-poster-url.ts:81`, `index.tsx:824-861`).
6. **Deal detail (10.4)** — `app/deal/[id].tsx` solid, but no address/directions on the screen itself (one tap away via `app/business/[id].tsx:381-396`), and claim states (sold out / expired / not started) aren't pre-rendered — they surface as post-tap server-error banners (`:275-289`).
7. **Wallet (10.7)** — `app/(tabs)/wallet.tsx` full-featured; missing the spec's directions link on claimed-deal cards. Minor.
8. **Consumer notifications & deep links (10.9, 16)** — favorites publish-push, focus-time nearby alerts, expiry reminder, weekly digest, and cold-start deep-link routing all work (`send-deal-push`, `lib/notifications.ts:92-231`, `components/notification-deeplink-handler.tsx:6-77`). Gaps: "new nearby deal" for non-favorites is local-notification-on-focus only (closed-app users get just the weekly digest), and shared-deal-received notifications don't exist.
9. **Settings & profile** — `app/(tabs)/settings.tsx` complete; the mode switch + demo gating are the pending item 2 remnants.

### Business
10. **Business onboarding (11.1)** — `app/business-setup.tsx:68-484` works incl. invite gate and trial defaults; missing initial-setup fields the spec lists (owner contact email, status enum, lat/lng — lat/lng editable later at `app/(tabs)/account.tsx:476,551`); terms is a hint, not an explicit accept; role storage pending item 2.
11. **Deal controls & publishing states (11.3/11.4)** — controls and validation are rich, and the strong-deal guard is **in sync** between client (`lib/strong-deal-guard.ts:27-132`) and SQL (`20260707130000_align_strong_deal_guard_with_client.sql:22-130`) — no drift. But the spec's stored state machine doesn't exist: states are derived (`lib/deal-time.ts:108-131`, `dashboard.tsx:943-945`); no draft persistence, no sold-out state, no owner-facing remaining quantity.
12. **Templates / scheduling / recurring (11.6)** — templates, reuse hub, run-again, future-start, recurring windows with server-side claim enforcement all work (`app/create/reuse.tsx:49-136`, `claim-deal/index.ts:304-310`). Spec's `scheduled_start_at`, `status='scheduled'`, `activate-scheduled-deals` and `generate-recurring-deals` crons, and `deal_templates.last_used_at` **do not exist** — the shipped derived-status design replaces them (code wins). **Concrete defect:** `app/create/reuse.tsx:268,279` pass the literal string `"theme.primary"` as a color — two CTA labels render with an invalid color.

### Architecture & AI
13. **Poster/image generation** — works, inline in `ai-compose-offer/index.ts:744-768` and `ai-generate-ad-variants` (`_shared/dalle-image.ts`); there is **no `ai-generate-deal-poster` function or client wrapper** anywhere, and the model is the **gpt-image-1 family, not DALL-E 3** (`dalle-image.ts:23-30`; gpt-image-2 deliberately excluded — hangs, documented `:13-21`). Image failure ships the ad imageless by design. Spec sections 12/3 are stale on both counts.
14. **DB schema vs spec 18** — all core tables present across 61 migrations. Divergences: no `recurring_deals` table (columns on `deals` instead), no `scheduled_start_at`, no scheduling crons, and **known prod drift**: `20260530120000_business_locations_deal_location.sql:83` adds `deals.location_id` which a hosted probe proved production lacks (42703). Migrations run ahead of the live DB — reconcile before relying on that column.

### Data & security
15. **RLS (19.3)** — core tables solid: claims insert locked to the edge function (`20260630120000`), PII column grants stripped (`20260705120000`), recursion-safe owner reads (`20260701130000`). **Gap:** `20260708120000_deal_viewed_daily_idempotency.sql:17-18` creates `app_analytics_events_backup_20260708` with no RLS/REVOKE — likely anon-readable (and writable) snapshot incl. `user_id`/`session_id`. The migration says drop after verification; it apparently never was.
16. **QR/claim code security (19.1)** — generation (CSPRNG short code, UUID token), server validation, atomic max-claims, single-use idempotent redeem are all strong. **Gap:** `20260705120007_failed_redeem_attempts.sql` designs a 10-failures/5-min lockout that `redeem-token/index.ts` never wires up (zero references) — failed short-code guessing is unthrottled (mitigated by ~1.07B code space + owner-scoping; 403-vs-404 is a small existence oracle).
17. **Share Deal codes & `deal_shares` (14.4, 19.2)** — schema, RLS, and the anon `lookup_deal_share` RPC match the spec (public preview fields only). Issues: codes use `Math.random()` not a CSPRNG (`lib/share-deal.ts:19-25`); the anon RPC increments `opened_count` unthrottled; insert policy lets any authed user mint a code for any deal id (incl. not-yet-live; low severity).
18. **Email confirmation app-side (17, item 6)** — signup → `emailRedirectTo` → `auth-callback` → awaiting-verification banner is coherent (`app/auth-landing.tsx:359-372,495-521`). The two gaps originally flagged here were closed by Batch 3: a resend-confirmation action now exists (`app/auth-landing.tsx` `handleResendConfirmation`, `supabase.auth.resend()` with a 60s cooldown), and unconfirmed logins surface a correct "confirm your email" message instead of the wrong-password one. Supabase-side SMTP/toggle/allow-list remain Dan's manual task per item 6 (see `docs/SMTP_SWAP_CHECKLIST.md`).
19. **Delete account (17)** — UI confirms, web fallback, and `delete-user-account` → `auth.admin.deleteUser` with verified FK cascades all work. Gaps: the purpose-built `purge_user_data(uuid)` RPC (`20260705120008`) is **never called**, so (a) `app_analytics_events.session_id` survives deletion and (b) claims are hard-deleted instead of anonymized — merchant dashboard history silently shrinks when a consumer deletes their account. Storage objects (logos, deal photos) also persist. Dead client handling of a removed error code at `app/(tabs)/account.tsx:360-372`.

---

## Broken (❌)

None at the feature level. The single concrete code defect found repo-wide is cosmetic and tracked under Partial item 12: `app/create/reuse.tsx:268,279` pass the literal string `"theme.primary"` as a color value, so two CTA labels render in an invalid color instead of brand orange.

---

## Not Built (🔲)

1. **Business notifications (11.8)** — N/A (no code exists). No owner-targeted notification of any kind: not deal-went-live, sold out, new claims, redemption summary, end-of-day performance, trial ending, or publish error. `send-deal-push` and `weekly-deal-digest` target consumers only; the only substitutes are the in-app post-publish flash (`lib/recent-publish.ts`) and dashboard metrics. The transport half already exists (owner push tokens register via `lib/push-token.ts`), so this needs recipient-side preference + send triggers.

*(Out-of-repo, not counted: the website `/s/<code>` preview page, AASA file, and assetlinks.json — the local `website/index.html` is a 53-line stub. Backend support (`lookup_deal_share` RPC) is already live-ready in this repo.)*

---

## Priority fixes (in order of impact)

1. **Drop or lock down `app_analytics_events_backup_20260708`** — un-RLS'd user analytics snapshot likely readable by anon in prod (`20260708120000:17-18`). Privacy exposure; Supabase-side action → hard gate, Dan applies.
2. **Reconcile `deals.location_id` prod drift** — migrations reference a column production provably lacks (`20260530120000:83`); any code path selecting it against prod 42703s. Decide: apply the migration (hard gate) or guard the code.
3. **Implement decided item 2** — hard role split at signup/login + delete all demo code paths (`lib/tab-mode.tsx`, `lib/demo-*`, `settings.tsx:622-632`, demo branches in `lib/functions.ts` and `ai-generate-deal-copy`). Required before store launch per spec section 4.
4. **Implement decided item 4** — three constants: `AI_COPY_MONTHLY_LIMIT` 60→30 (`ai-generate-deal-copy/index.ts:209`), `SOFT_REVISION_CAP` 5→2 (`app/create/ai.tsx:232`), `MAX_REVISION_COUNT` 10→2 (`ai-generate-ad-variants/index.ts:42`). Small, server-enforced, cheap win.
5. **Ship the website `/s/` preview + AASA + assetlinks** (website repo) — until then universal links don't verify and shared links land on a stub; app-side config is already correct.
6. **Wire `purge_user_data` into `delete-user-account`** — restores claim anonymization (preserving merchant metrics) and session-id scrubbing; also clean orphaned Storage objects. Store delete-account compliance is met today, but data handling contradicts the repo's own design.
7. **Add confirmation-email resend + fix the unconfirmed-login error mapping** (`lib/i18n/api-messages.ts:94-96`, `app/auth-landing.tsx`) — with confirm-email staying ON (item 6), a lost email currently strands the user with a "wrong password" message.
8. **Build minimum business notifications (11.8)** — at least new-claim and sold-out pushes; transport exists. Biggest pilot-value gap (the one 🔲).
9. **Wire the `failed_redeem_attempts` lockout into `redeem-token`** and switch share-code generation to a CSPRNG (`lib/share-deal.ts:19-25`); optionally rate-limit `lookup_deal_share`. Hardening, low effort.
10. **Fix `app/create/reuse.tsx:268,279`** literal `"theme.primary"` color strings; while in consumer UI, surface quantity remaining on feed cards (`app/(tabs)/index.tsx`, data already fetched at `:75`).

---

## Spec/code conflicts (code wins — spec text is stale)

Per CLAUDE.md these are reported, not silently followed: (a) no `ai-generate-deal-poster`, `activate-scheduled-deals`, or `generate-recurring-deals` functions — replaced by inline poster generation and derived/recurring-columns design; (b) Quick Deal uses `aiGenerateAd`/`ai-generate-ad-variants`, not `aiGenerateDealCopy`; (c) `ai-generate-deal-copy` returns one result, not 2–3 styled variants; (d) image model is gpt-image-1 family, not DALL-E 3; (e) no `recurring_deals` table, `scheduled_start_at`, or `deal_templates.last_used_at`; (f) no dedicated Favorites tab; (g) onboarding has no language or notification step (auth-landing flag switcher + deferred consent instead); (h) no generic-photo poster fallback (branded placeholder); (i) deal states derived, not stored; (j) spec 18's device-token `enabled` column is actually `consumer_profiles.deal_alerts_enabled`/`notification_mode`, and `deal_shares` uses `opened_count`/`first_opened_at`/`last_opened_at`.
