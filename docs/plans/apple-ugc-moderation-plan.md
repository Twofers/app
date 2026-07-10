# Apple UGC / Moderation Compliance Plan (Guideline 1.2)

**Goal:** satisfy Apple's four UGC requirements so the reviewer can see each one in the build:
1. A method for filtering objectionable material.
2. A mechanism to report offensive content, with timely responses (Apple's historical bar: act within 24 hours).
3. The ability to block abusive users — read by reviewers as a **user-facing, tappable control**, not back-office tooling.
4. Published contact information.

**Strategy:** smallest visible build. Most of item 2 already exists; item 1 is already true operationally (vetted merchants + admin approval + AI validation) and just needs to be stated in review notes; items 3 and the "timely response" half of 2 are the real build work. One new table, one new lib file, small UI touches, one terms section, one admin page.

---

## What already exists (verified in code — do not rebuild)

- **Report mechanism (app):** `components/report-sheet.tsx` + `lib/reports.ts`. "Report this offer" link on the deal screen (`app/deal/[id].tsx:1015`) with reasons including `inappropriate`; businesses can report customers from `app/(tabs)/redeem.tsx`.
- **Report backend:** migration `supabase/migrations/20260705130000_reports.sql` — `business_reports` + `user_reports` tables, `report_business` / `report_user` SECURITY DEFINER RPCs, RLS in place.
- **Signup legal footer:** `app/auth-landing.tsx:926` — "By continuing you agree to our Terms and Privacy Policy" (`authLanding.legalFooter` in `lib/i18n/locales/{en,es,ko}.json:986`) with working links. Passive, no checkbox.
- **Website legal pages:** `website/terms/index.html`, `website/privacy/index.html`, `website/support/index.html` (public contact = support@twoferapp.com, a locked decision). Terms currently have **no objectionable-content / conduct clause**.
- **Per-user deal-hiding pattern to copy:** `lib/repeat-claim-visibility.ts` — client-side filter helpers, applied in the consumer feed (`app/(tabs)/index.tsx:866`), the map (`components/map/map-native-screen.tsx`), and `app/business/[id].tsx`. Has a test file `lib/repeat-claim-visibility.test.ts` to mirror.
- **Admin site pattern:** static pages under `website/admin/` calling admin edge functions (e.g. `admin-dashboard-summary`) authenticated via `admin-auth-session`; nav lives in each page's header.

## Verify before building (read-only)

- **Confirm the reports migration is live in production.** The deal-screen report button ships in the app, but memory records are ambiguous about whether `20260705130000_reports.sql` was applied. Verify by calling `report_business` behavior read-only (or checking `pg_proc`/tables via an existing probe script pattern). If it is NOT applied, applying it becomes Dan-gated step 0 of this plan.
- Confirm support email is visible somewhere reachable in the app (it appears in `app/(tabs)/settings.tsx` and `app/(tabs)/account/index.tsx`) and on `website/support/`.

---

## Work item 1 — Hide-merchant ("block") — the main build

**DB (one migration, Dan-gated to apply):** `supabase/migrations/<ts>_hidden_businesses.sql`

```sql
CREATE TABLE public.hidden_businesses (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);
```

RLS: enable; one policy per verb (SELECT/INSERT/DELETE) all scoped to `auth.uid() = user_id`. No UPDATE. Grant to `authenticated` only (remember the Supabase quirk: revoke from `anon` and `PUBLIC` explicitly). Direct table access — no RPC needed, this is the simplest correct shape. **After applying: run `node scripts/probe-rls-smoke.mjs` (mandatory per repo rules).**

**Client lib:** new `lib/hidden-businesses.ts` mirroring the shape of `repeat-claim-visibility.ts`:
- `loadHiddenBusinessIds(userId): Promise<Set<string>>` — returns empty set on any error so the feed degrades to showing everything (same fail-open philosophy as the repeat-claim helpers; this is a preference, not a security control).
- `hideBusiness(businessId)` / `unhideBusiness(businessId)` — insert (upsert, ignore duplicates) / delete.
- Unit tests in `lib/hidden-businesses.test.ts` mirroring `repeat-claim-visibility.test.ts`.

**Filtering (WHERE-clause equivalent):** add `!hiddenBusinessIds.has(deal.business_id)` alongside the existing `isDealHiddenByRepeatPolicy` checks in:
- Consumer feed `app/(tabs)/index.tsx` (load hidden ids in the same `Promise.all` at ~line 448, filter at ~line 866).
- Map `components/map/map-native-screen.tsx` (same spots where repeat-claim filtering runs).
- Do **not** filter `app/business/[id].tsx` itself — if the user navigates there directly (e.g. from Saved), show a small "You've hidden this business — Unhide" pill instead of its deals being invisible with no explanation. Simplest: banner at top with an Unhide action; deals below render normally once unhidden.

**Entry points (what the reviewer taps):**
- `app/deal/[id].tsx`: add a "Hide this business" link directly next to the existing "Report this offer" link (~line 1015–1024). Tapping shows the branded confirm (`useBrandedConfirm`, per repo convention — not `Alert.alert`), then hides and pops back to the feed with a toast/snackbar-style confirmation if one exists in the codebase (otherwise the confirm dialog's success state is enough).
- `components/report-sheet.tsx`: after a successful business report, offer "Also hide this business?" as a follow-up action in the success state. This is the "report → block" pairing reviewers look for.
- `app/business/[id].tsx`: add the same Report + Hide actions (ReportSheet is reusable as-is; pass `businessId` without `dealId`).

**Undo / management UI:** in `app/(tabs)/settings.tsx` (consumer side), add a "Hidden businesses" row → simplest implementation is an expandable section (like the favorites dropdown pattern) listing hidden business names with an "Unhide" button per row. Needs a join query: `hidden_businesses` ids → `businesses.name`. Keep it plain; empty state: "Businesses you hide won't appear in your feed."

**Copy (all new strings in `lib/i18n/locales/en.json` + `es.json` + `ko.json`, per localization rule; keep wording minimal per Dan's copy preference):** hide link, confirm title/body, unhide, hidden-banner, settings row, empty state.

## Work item 2 — Terms acceptance checkbox at signup

`app/auth-landing.tsx`, signup mode only:
- Add a required checkbox row above the "Create account" button: label reuses the `<Trans>` link pattern — "I agree to the <terms>Terms of Service</terms>, which prohibit objectionable content and abusive behavior." Links to the same `TERMS_OF_SERVICE_URL`.
- "Create account" disabled until checked. Login mode untouched; keep the existing `legalFooter` for both modes.
- New i18n key in en/es/ko. No DB write needed — the checkbox gating account creation is what reviewers look for; do not build an acceptance-audit table (over-engineering for this requirement).

## Work item 3 — Website: conduct clause in Terms

`website/terms/index.html`: add a "Community conduct" section after "Redemption":
- Objectionable, offensive, or abusive content and behavior are prohibited.
- Anyone can report a business or offer in the app; reports are reviewed and acted on **within 24 hours**, including removing content and ejecting offending accounts.
- Users can hide any business from their feed.
- Contact: support@twoferapp.com.

Follow the existing `data-i18n` pattern and add the en/es/ko strings to the website's localization dictionary (`website/localization.js` — match how existing `terms.*` keys are registered). Mirror a short version of the same clause in `website/business-terms/index.html` (merchants are the content producers — their terms should prohibit objectionable offer content explicitly).

## Work item 4 — Website: admin Reports queue (the "timely response" half)

This is what makes "we act within 24 hours" true without Supabase Studio archaeology.

- New page `website/admin/reports/index.html` + `website/admin/reports.js`, cloned from the simplest existing admin page (e.g. audit-log). Lists open `business_reports` and `user_reports` (reason, comment, business/deal/user context, age), with actions: **mark reviewed**, **dismiss**, and a link to the existing `/admin/businesses/detail` and `/admin/offers` pages where takedown already lives.
- New edge function `supabase/functions/admin-reports/index.ts` following the existing admin function pattern (same auth as `admin-dashboard-summary`; service role reads/updates on the two report tables). Actions: `list`, `set_status`.
- Add "Reports" to the admin nav header in the admin pages' shared nav markup, and an "Open reports" count card on the admin overview next-actions list (`admin-dashboard-summary` gains one cheap count query).
- Keep it read-and-triage only. Takedown itself is not new work — deactivating an offer/business already exists in admin.

Deploying the edge function and the website are **Dan-gated**; build and test locally, then hand Dan the deploy list.

## Work item 5 — App Review notes (draft for Dan to paste into App Store Connect)

> All offers in Twofer are created by verified business owners, not anonymous users. Content is filtered in three layers: businesses are manually vetted and approved before they can publish; all AI-assisted offer content passes automated validation before publication; and our admin console can remove any offer or business immediately. Users can report any offer or business in the app (Report button on every offer and business page) and can hide any business from their feed (Hide button next to Report). Reports feed a moderation queue that is reviewed daily; we act on reports within 24 hours, including removing content and terminating offending accounts. Users agree to Terms of Service prohibiting objectionable content and abusive behavior at signup. Contact: support@twoferapp.com (also published at twoferapp.com/support).

Save this into `docs/release/APP_STORE_METADATA_DRAFT.md` (file already exists and is the natural home).

---

## Explicitly NOT in scope (keep it simple)

- No automated text/image scanning of deals — merchant vetting + AI-output validation + admin removal already satisfy item 1 for vetted-producer content; say so in review notes instead of building a filter.
- No consumer-to-consumer blocking — consumers never see each other's content in Twofer.
- No push/email notification pipeline for new reports (Dan checks the admin queue daily; can be a follow-up).
- No changes to AI poster/prompt lock files, billing, or claim flows.

## Suggested build order

1. Read-only verification (reports migration live? support email visible?).
2. Hidden-businesses migration file + `lib/hidden-businesses.ts` + tests (no prod apply yet).
3. App UI: hide entry points, feed/map filters, business-page banner, settings management row, i18n keys.
4. Signup checkbox + i18n keys.
5. Website terms conduct sections (consumer + business) + localization strings.
6. Admin reports page + `admin-reports` edge function + nav/count wiring.
7. Review-notes paragraph into `docs/release/APP_STORE_METADATA_DRAFT.md`.
8. Validation: `npm run typecheck`, `npm run lint`, `npm test`, `npm run typecheck:functions`, focused tests for the new lib.
9. **STOP for Dan's approval:** apply migration (then immediately `node scripts/probe-rls-smoke.mjs`), deploy `admin-reports`, deploy website, rebuild app.

## Hard-gated items requiring Dan's explicit approval

- Applying `hidden_businesses` migration (and `20260705130000_reports.sql` if it turns out to be unapplied).
- Deploying the `admin-reports` edge function.
- Deploying the website (terms + admin reports page).
- Any app rebuild/submission.
