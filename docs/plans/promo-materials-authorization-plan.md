# Plan: Optional Promotional Materials Authorization (Business Onboarding)

Status: PLAN — approved for implementation by Opus. Written 2026-07-19 after a read-only audit of the terms system, onboarding surfaces, location model, admin dashboard, and audit-log architecture.

## 0. Objective (summary)

Add an **optional** disclosure + consent letting a business authorize Twofer to place removable promotional materials (countertop displays, window decals, QR signs) at its location.

Hard requirements:
- Optional. Onboarding, terms acceptance, trial, billing, and publishing must all work without it.
- Business Terms get a new "Promotional Materials" section (disclosure only — accepting terms must NOT grant placement permission).
- Separate, unchecked, clearly-optional checkbox in business onboarding. Never pre-checked, never combined with the required terms checkbox.
- Location-level consent record with full audit fields; revocable from account settings; history preserved.
- Admin dashboard shows status; admin-assisted recording is allowed only with authorizer identity + audit log, labeled "Recorded by Twofer on behalf of business".
- Not in the consumer Terms of Service. No changes to consumer flows.

## 1. Audit findings (verified in code — use as ground truth)

### Terms system
- Version constant: `CURRENT_BUSINESS_TERMS_VERSION = "2026-07-01"` at `supabase/functions/_shared/business-onboarding-sync.ts:5` (date-string versioning, single source of truth; no version printed in the HTML doc).
- Business Terms document: `website/business-terms/index.html`, i18n-keyed via `data-i18n="businessTerms.*"` with translations in `website/localization.js` AND app locale files `lib/i18n/locales/{en,es,ko}.json`.
- Acceptance table: `public.terms_acceptances` (migration `supabase/migrations/20260730126000_website_app_onboarding_sync.sql:258-272`). Columns: business_id, user_id, document_type ('business_terms'|'privacy_policy'), document_version, accepted_at, source, ip_address, user_agent. Writes are service_role-only; members can SELECT (`terms_acceptances_member_read`).
- Writers: edge fn `accept-business-terms` (source `app_owner_explicit`; authz via `assertCanAccept()` = business `owner_id` OR active `owner`/`manager` in `business_members`; also logs to `business_profile_revision_log` and re-runs `can_business_publish`), and `business-onboarding-sync.ts:286-311` for website signups.
- Publish gate: `can_business_publish` (same migration, ~lines 533-540) returns `terms_required` when NO business_terms row exists — **version-agnostic**. Bumping the version does NOT re-prompt existing businesses. That is the current versioning policy; keep it.
- App gate UI: `components/business-terms-gate.tsx`, rendered from `app/(tabs)/create.tsx` (state `termsRequired` from onboarding context `reason_code`).

### Onboarding surfaces
- App signup/role selection: `app/auth-landing.tsx` (required consumer ToS checkbox lives here — DO NOT TOUCH).
- Business profile setup: `app/business-setup.tsx` (~1291 lines). Has a legal consent block near submit (`LegalExternalLinks`, ~lines 1230-1233) and a precedent for an optional checkbox (`importConsent`, lines 966-980). Submits via `updateBusinessProfileSection` edge fn or direct `businesses` write.
- Website business intake: `website/business/start-trial/index.html` — "Request Business Access" form with required `terms_accepted` + `privacy_acknowledged` checkboxes (lines 142-151), posts to edge fn `submit-business-application`, which feeds `business-onboarding-sync.ts` (creates business + writes `terms_acceptances`).
- Account settings: `app/(tabs)/account/index.tsx` (~1808 lines) — existing per-business toggle pattern (`claim_notifications_enabled` with feature-detection + optimistic rollback), and the sanctioned versioned path `updateBusinessProfileSection`.

### Locations
- `public.business_locations` (migration `20260530120000_business_locations_deal_location.sql`): id, business_id FK→businesses, name, address, phone, lat, lng, created_at. Owner-scoped RLS. Pilot cap = 1 location (premium 3) enforced by INSERT RLS via `public.business_location_count(uuid)` (migration `20260807130000_fix_business_locations_recursion.sql`).
- **No location-editing UI exists.** Only client consumer is `hooks/use-business-locations.ts`, which auto-creates a default location on first mount. A location row may NOT yet exist when onboarding consent is given — the server must find-or-create the primary location.
- Known pre-existing bug (do not fix in this task, just don't copy it): cap policies join `business_profiles bp ON bp.id = business_locations.business_id`, which is likely the wrong table. Flagged separately.

### Roles
- Owner = `businesses.owner_id`. Manager = `business_members.role IN ('owner','manager')` with `status='active'` (table in `20260730126000`, writes service_role-only). `accept-business-terms`'s `assertCanAccept()` is the existing owner-or-manager authz helper — reuse its pattern. Redeemer JWTs must stay blocked (RESTRICTIVE `redeemer_*_block_all` pattern from `20260712120000_redemption_mode_staff_sessions.sql`).

### Admin + audit
- Admin dashboard = static site `website/admin/`; business detail page `website/admin/businesses/detail/index.html` rendered by `website/admin/admin-directory.js` (`business_detail` branches at lines ~649 and ~793), backed by edge fn `admin-dashboard-summary` (`business_detail` section).
- Admin authz pattern: `requireAdmin` (see `supabase/functions/admin-business-applications/index.ts:311-369` and `_shared/admin-prospects.ts:139-216`): service-role dual client, `admin_users` lookup, MFA `aal2`, `roleCan(role, permission)`; DB-side `public.admin_can(permission)` for RLS.
- Audit log: append-only `public.admin_audit_log` (migration `20260730125000_admin_dashboard_foundation.sql:20-34`; service_role SELECT+INSERT only). Shared writer helper: `audit(ctx, {...})` in `_shared/admin-prospects.ts:218-242`.
- Precedent for "admin acts for business": `admin-trial-create-from-prospect` (provenance via `source` field), `admin-claim-link-create` (`created_by_admin_user_id`).

### Testing/migrations conventions
- Vitest: `supabase/functions/_shared/*-source.test.ts` (source-shape assertions) and `*-migration.test.ts` (assert migration SQL). Live-DB suites: `scripts/db-tests/2a…2f-*.mjs` via `npm run test:db` (guarded by `assert-test-db.mjs`). RLS probes: `scripts/probe-rls-smoke.mjs`.
- Migration naming: `YYYYMMDDHHMMSS_snake_case.sql`; most recent is `20260818120000_revoke_qr_campaign_fn_client_execute.sql`. Use `20260819120000_promo_materials_authorizations.sql`.
- RLS rule from prior incident: in RESTRICTIVE policies always `COALESCE(<expr>, false)`. After applying any RLS migration, run `node scripts/probe-rls-smoke.mjs`.

## 2. Data model (new migration `supabase/migrations/20260819120000_promo_materials_authorizations.sql`)

Do NOT store a bare boolean on `businesses`. Create a consent-record table matching the `terms_acceptances`/`admin_audit_log` audit architecture:

```sql
create table public.promo_materials_authorizations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  location_id uuid not null references public.business_locations(id) on delete cascade,
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references auth.users(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,          -- person making the selection
  authorizer_name text,                                               -- when available (required for admin path)
  authorizer_role text,                                               -- e.g. 'owner', 'manager' (required for admin path)
  business_terms_version text not null,                               -- CURRENT_BUSINESS_TERMS_VERSION at grant time
  source text not null check (source in
    ('app_onboarding','app_settings','website_onboarding','admin_assisted')),
  recorded_by_admin_user_id uuid references public.admin_users(id) on delete set null,
  permission_received_at timestamptz,                                 -- admin path: date business gave permission
  created_at timestamptz not null default now()
);
```

Semantics (append-only event model):
- **Grant** = INSERT a new row. **Revoke** = set `revoked_at` + `revoked_by_user_id` on the open row. Never DELETE, never rewrite history. Re-grant after revoke = a new row.
- **Current status for a location** = "Authorized" iff a row exists with `revoked_at IS NULL`. Enforce at most one active row per location:
  `create unique index promo_auth_one_active_per_location on public.promo_materials_authorizations(location_id) where revoked_at is null;`
- Constraint: `check (source <> 'admin_assisted' or (authorizer_name is not null and authorizer_role is not null and permission_received_at is not null and recorded_by_admin_user_id is not null))` — an admin cannot record a bare authorization.
- Indexes: `(business_id, created_at desc)`, `(location_id)`.

Grants + RLS (copy the `terms_acceptances` pattern from `20260730126000`):
- `alter table ... enable row level security;`
- `revoke all ... from public, anon, authenticated;` then `grant select ... to authenticated;` and `grant select, insert, update ... to service_role;` (UPDATE needed only for setting `revoked_at`; no DELETE grant to anyone — remember the memory lesson: revoke from anon AND authenticated explicitly, not just PUBLIC).
- SELECT policy for business members: reuse `public.is_business_member(business_id)` (defined in `20260730126000`) OR owner check, wrapped in `coalesce(..., false)`.
- Admin SELECT policy via `public.admin_can('...')` is unnecessary if admin reads go through service-role edge fns (they do) — skip it to keep surface minimal.
- RESTRICTIVE redeemer block policy mirroring `redeemer_*_block_all` (with `coalesce(public.is_redeemer_session(), false)` guard per the established pattern).
- All client writes go through a new edge function (below) — no authenticated INSERT/UPDATE policies. This is the same trust model as `terms_acceptances` and `owner_redemption_security`.

Backfill: **none**. Existing businesses have no rows → status "Not authorized". That is exactly the required default; verify no seed/backfill logic sneaks in.

## 3. Server: new edge function `set-promo-materials-authorization`

Model directly on `supabase/functions/accept-business-terms/index.ts`:
- Auth: bearer user; reject redeemer users; authorize via the same owner-or-active-manager check as `assertCanAccept()` (factor it into `_shared/` if cleanly possible, otherwise copy the pattern). This satisfies "owner or authorized manager can approve or revoke".
- Request body: `{ business_id, location_id?, action: 'authorize' | 'revoke', authorizer_name?, authorizer_role? }`.
- Location resolution: if `location_id` omitted, find the business's location(s); if exactly one, use it; if none exists yet (onboarding-time race — the client hook auto-creates lazily), **find-or-create the primary location server-side** with the same shape `hooks/use-business-locations.ts` uses (name "Primary location" / businesses.address, lat, lng). If multiple locations and no `location_id`, return 400 — consent is per-location.
- `authorize`: if an active row exists → idempotent no-op (return current). Else INSERT with `user_id = caller`, `business_terms_version = CURRENT_BUSINESS_TERMS_VERSION` (import from `_shared/business-onboarding-sync.ts`), `source` from a validated client hint restricted to `app_onboarding` | `app_settings` (server decides `admin_assisted`/`website_onboarding` — never accept those from the app client). `authorizer_name`/`authorizer_role` optional; default `authorizer_role` from the caller's membership role when derivable. Do not collect anything beyond name/role.
- `revoke`: set `revoked_at = now()`, `revoked_by_user_id = caller` on the active row; 404/no-op if none. Never delete.
- Mirror `accept-business-terms`'s revision-log write: insert a `business_profile_revision_log` row (`section_key: 'promo_materials_authorization'`) so owner-side history is consistent.
- Response: `{ authorized: boolean, location_id, authorized_at, revoked_at }`.
- **Must NOT touch** `can_business_publish`, capabilities, billing, trial, or verification in any way.

Client wrapper: add `setPromoMaterialsAuthorization()` / `getPromoMaterialsAuthorization()` in a small `lib/promo-materials.ts` (follow `lib/business-terms.ts` — kept OUT of the hash-locked `lib/functions.ts` AI wrapper). Status read = direct authenticated SELECT on the table (RLS member-read allows it), no extra fn needed.

## 4. Business Terms document changes

1. `website/business-terms/index.html`: add a section titled **"Promotional Materials"** with the exact required language (below), using new i18n keys `businessTerms.promoMaterialsTitle` / `businessTerms.promoMaterialsBody` (match existing `data-i18n` structure; split into multiple body keys if the page's existing sections do that).

> The Business may authorize Twofer to provide and place removable promotional materials, including countertop displays, window decals, QR-code signs, or similar materials, at participating locations. The Business retains control over the location and display of all materials and may move or remove them at any time. Twofer will not permanently attach promotional materials or intentionally damage the premises. The Business represents that it has the authority to approve the placement of promotional materials or has obtained any required permission from the property owner, landlord, franchisor, or other applicable party.

2. Add one clarifying sentence immediately after (permitted "minor formatting" addition, required by the spec's no-implied-consent rule): *"This authorization is optional and is granted separately; accepting these Business Terms does not itself authorize placement of promotional materials."*
3. Translations: add the EN keys to `website/localization.js` and to `lib/i18n/locales/en.json`, with ES and KO translations in `es.json`/`ko.json` and the website localization map. (ES follows the repo's Mexican-Spanish conventions.)
4. Bump `CURRENT_BUSINESS_TERMS_VERSION` in `supabase/functions/_shared/business-onboarding-sync.ts:5` to `"2026-07-19"` (or the actual date the change ships — pick one value and use it everywhere). Because `can_business_publish` is version-agnostic, existing businesses are NOT re-prompted — that is the current versioning policy and this task must not change it. Flag for Dan under Open Items.
5. Do NOT touch `website/terms/index.html` (consumer ToS) or `app/auth-landing.tsx`'s consumer terms checkbox.

## 5. UI changes

### 5a. App onboarding — `app/business-setup.tsx`
- Add an optional checkbox block near the legal/consent area (~line 1230), visually separate from any required element, following the existing `importConsent` checkbox pattern (lines 966-980, `accessibilityRole="checkbox"`).
- Label with an explicit "(Optional)" tag line above the checkbox. Copy (i18n key `businessSetup.promoAuthOptionalLabel` + `businessSetup.promoAuthCheckbox`):
  - Section label: **"Optional: In-store promotional materials"**
  - Checkbox: **"Yes, I authorize Twofer to provide and place removable promotional materials at this location. I understand that I may move or remove them at any time."**
- Default `useState(false)`. Never blocks submit; no error state for leaving it unchecked; no negative framing for declining (no "No thanks"-style copy, no warning colors).
- On successful profile submit, if checked, fire `setPromoMaterialsAuthorization({ action: 'authorize', source: 'app_onboarding' })` fire-and-forget-with-toast-on-error style — a failure here must NOT fail or block onboarding completion (log + show a soft notice that they can enable it later in Account).
- Do NOT add it to `components/business-terms-gate.tsx` — keeping it out of the terms gate guarantees it is never visually combined with required terms acceptance.

### 5b. App settings — `app/(tabs)/account/index.tsx`
- Add a "Promotional materials" row in the business section showing current status (Authorized / Not authorized) with a toggle-style control, following the `claim_notifications_enabled` pattern (feature-detect table readability; hide row if SELECT fails, e.g. before migration is applied).
- Authorize path: same edge fn, `source: 'app_settings'`.
- Revoke path: use `useBrandedConfirm` (repo convention — never `Alert.alert`) with confirmation copy (key `account.promoAuthRevokeConfirm`): **"Promotional materials will be marked Not authorized. You may remove any existing Twofer promotional materials from your location at any time."** After revoke, status shows "Not authorized"; history rows remain.
- Keep copy minimal (repo feedback: few-words screens). Status line + one short explainer sentence max.

### 5c. Website intake — `website/business/start-trial/index.html`
- Add an optional, unchecked checkbox inside the optional `<details>` area (NOT next to the two required consent checkboxes at lines 142-151), with the same checkbox copy and an "Optional" label, i18n-keyed via `website/localization.js`.
- Wire `promo_materials_authorized` into the JSON payload of `submit-business-application` (default false; absence = false).
- `supabase/functions/submit-business-application`: accept and normalize the flag; persist it on the application (add nullable `promo_materials_authorized boolean` to `business_applications` in the same migration, default false — safe for existing rows).
- `_shared/business-onboarding-sync.ts`: when syncing an application into a business (the same place it writes `terms_acceptances`, lines 286-311), if the flag is true, insert a `promo_materials_authorizations` row with `source: 'website_onboarding'`, `user_id` = the owner user when known, resolving/creating the primary location the same way as the edge fn (share a `_shared/promo-materials.ts` helper). If false, write nothing.

## 6. Admin dashboard

### 6a. Display (read-only) — required
- `supabase/functions/admin-dashboard-summary`, `business_detail` section: add a `promo_materials` block — for each business location: status (Authorized / Not authorized), location name/address, `authorized_at`, `authorizer_name`/`authorizer_role` (or the source when name absent), `revoked_at` when applicable, and `source`. When `source = 'admin_assisted'`, include label text **"Recorded by Twofer on behalf of business"**.
- `website/admin/admin-directory.js` (`business_detail` render branch ~line 793) + `website/admin/businesses/detail/index.html`: render the block alongside the existing verification/health cards. Read-only status display; no toggle.

### 6b. Admin-assisted recording — implement, tightly constrained
- New edge function `admin-promo-authorization` (follows the `admin-*` naming + `requireAdmin` pattern with MFA `aal2` + `roleCan`; reuse an existing write-level permission such as the one gating business application decisions rather than inventing a new permission tier, unless the matrix makes a new `business.consent.write` entry cleaner — match `_shared/admin-prospects.ts:113-138`).
- Required inputs (reject otherwise): `business_id`, `location_id`, `authorizer_name`, `authorizer_role`, `permission_received_at` (date permission was given in person), plus a fixed `source: 'admin_assisted'` set server-side. There is no way for an admin to record authorization without identifying the authorizing person — the table CHECK constraint (§2) backs this up at the DB layer.
- Writes: INSERT the authorization row (`recorded_by_admin_user_id = ctx admin`), then `audit(ctx, { action: 'admin_promo_authorization_recorded', targetType: 'promo_materials_authorization', targetId, businessId, afterValue: {...} })` via the shared helper in `_shared/admin-prospects.ts:218-242`. Also support `action: 'revoke'` with its own audit action (`admin_promo_authorization_revoked`) for assisted revocations, same required identity fields.
- Admin UI: small form on the business detail page (name, role, date received) with the button labeled to make provenance explicit ("Record in-person authorization"). Rendered status must always show the "Recorded by Twofer on behalf of business" label for these rows.

## 7. Isolation guarantees (verify, don't just avoid)

- `can_business_publish` (migration `20260730126000` ~533-569): unchanged. Add a source/migration test asserting no reference to `promo_materials` appears in any capabilities/publish-gate SQL or in `get-business-onboarding-context`.
- No changes to: billing functions, Stripe functions, trial creation (`admin-trial-create-from-prospect` — except nothing), verification (`admin-business-applications` decision paths), deal creation/publish (`publish-offer-version`), consumer flows (`app/onboarding.tsx`, `website/terms/index.html`, shopper screens).
- No RLS weakening: the new table adds policies only on itself; no existing policy is modified.
- Locked AI files: none of the AI poster/ad lock-listed files are touched. If any edit accidentally lands in a locked path, stop.

## 8. Tests (map to the 12 required cases)

New files, following repo conventions:

1. `supabase/functions/_shared/promo-materials-migration.test.ts` — asserts migration SQL contains: table + columns (incl. `authorizer_name`, `business_terms_version`, `source` CHECK, admin CHECK constraint), partial unique active-per-location index, RLS enable, revokes from anon/authenticated, no DELETE grant, `coalesce(` in restrictive policy, redeemer block. Covers required cases 4 (schema), 7 (history preserved — no delete), 8 (no backfill → default not authorized).
2. `supabase/functions/_shared/promo-materials-source.test.ts` — asserts edge-fn source: owner/manager authz + redeemer rejection (case 5), revoke sets `revoked_at` and never deletes (cases 6, 7), source whitelist excludes `admin_assisted` from client path, terms version stamped from the shared constant (case 11 linkage), and that `accept-business-terms` + `business-onboarding-sync` contain NO automatic promo authorization when only terms are accepted (case 3). Also assert `submit-business-application` treats the flag as optional/defaulting false (case 1).
3. `supabase/functions/_shared/admin-promo-authorization-source.test.ts` — requireAdmin + MFA + required authorizer fields + `audit(` call with the new action names + "Recorded by Twofer on behalf of business" label present in summary/renderer (case 10).
4. Component/source test for UI defaults (follow existing component test style under `components/`): business-setup promo checkbox initial state is `useState(false)` and submit is not gated on it (cases 1, 2); account revoke uses `useBrandedConfirm` and shows the removal-notice copy.
5. `scripts/db-tests/2g-promo-materials-authorization.mjs` (register in `scripts/db-tests/run.mjs`) — live-DB: cross-tenant write/read denial (case 5), grant→status, revoke→status flips to not-authorized while the row survives (cases 6, 7), existing business with zero rows reads as not authorized (case 8), and `can_business_publish` returns the same result for a business with and without authorization (case 9).
6. Case 11 (versioning): extend `business-terms-acceptance-source.test.ts` expectations for the bumped `CURRENT_BUSINESS_TERMS_VERSION` and assert the publish gate remains version-agnostic (existing behavior).
7. Case 12 (app/website consistency): source test asserting the app checkbox copy key and website checkbox copy resolve to the same English sentence (compare `lib/i18n/locales/en.json` key with `website/localization.js` key).

Validation commands: `npm run typecheck`, `npm run typecheck:functions`, `npm run lint`, `npm test`; `npm run test:db` only against the test project (guarded by `assert-test-db.mjs`); after Dan applies the migration: `node scripts/probe-rls-smoke.mjs`.

## 9. File-change inventory (expected)

- NEW `supabase/migrations/20260819120000_promo_materials_authorizations.sql`
- NEW `supabase/functions/set-promo-materials-authorization/index.ts`
- NEW `supabase/functions/admin-promo-authorization/index.ts`
- NEW `supabase/functions/_shared/promo-materials.ts` (location resolve/create + insert helper shared by edge fn + onboarding sync)
- EDIT `supabase/functions/_shared/business-onboarding-sync.ts` (version bump + website-consent sync)
- EDIT `supabase/functions/submit-business-application/index.ts` (optional flag)
- EDIT `supabase/functions/admin-dashboard-summary/index.ts` (business_detail promo block)
- NEW `lib/promo-materials.ts`
- EDIT `app/business-setup.tsx`, `app/(tabs)/account/index.tsx`
- EDIT `website/business-terms/index.html`, `website/business/start-trial/index.html`, `website/localization.js`
- EDIT `website/admin/businesses/detail/index.html`, `website/admin/admin-directory.js`
- EDIT `lib/i18n/locales/en.json`, `es.json`, `ko.json`
- NEW/EDIT test files per §8

## 10. Hard gates & sequencing for the implementer

1. Work on the current branch state; do NOT overwrite uncommitted work (repo carries live QA artifacts). One scoped commit only when Dan asks.
2. Do NOT apply the migration, deploy any edge function, deploy the website, or push. Stop before deployment and output the exact commands for Dan's review, which will be:
   - `npx supabase db push` (or the repo's migration-apply flow) for `20260819120000_promo_materials_authorizations.sql`, then `node scripts/probe-rls-smoke.mjs`
   - `npx supabase functions deploy set-promo-materials-authorization admin-promo-authorization submit-business-application admin-dashboard-summary` plus any fn importing the changed `_shared/business-onboarding-sync.ts` (`accept-business-terms`, `business-claim-link`, etc. — enumerate at build time). Deploy from the working tree the code was edited in (worktree-deploy rule).
   - Website deploy (Vercel) for the terms page + start-trial form + admin pages.
   - App rebuild for the two app screens.
3. Ordering constraint: the app UI feature-detects the table, and the version bump only takes effect on fn deploy — so migration → functions → website → app rebuild is the safe order; nothing breaks if the app ships later.

## 10b. Implementation note — website-intake consent (resolved 2026-07-19)

§5c assumed `materializeBusinessForUser` / `syncDerivedRows` in `_shared/business-onboarding-sync.ts` was the live path that turns a website application into a business. It is **not**: that function has had zero production callers since migration `20260817120000_approved_not_activated_activation_gate.sql` introduced the SQL routine `public.claim_approved_business_application_for_user`, which `get-business-onboarding-context` now calls. The routine materializes a business only after the owner's auth email is confirmed — deliberate hardening, because `submit-business-application` is public and unauthenticated.

Consequence: the existing `terms_acceptances` write in that file is dead too, and website terms consent is instead recorded on `business_applications.terms_accepted` / `business_onboarding_requests.accepted_business_terms`, with the real acceptance coming from the authenticated owner through `accept-business-terms` (the publish gate still returns `terms_required` until then).

**Decision (Dan, 2026-07-19): leave as is.** The promo-materials consent write stays wired in the same (unreachable) place for consistency, and is annotated as such in code. The website checkbox is recorded as a preference on `business_applications.promo_materials_authorized`; actual authorization is granted by the authenticated owner via `set-promo-materials-authorization` — matching the posture terms acceptance already has, which is the stronger position for a legal permission. No port into the SQL routine or the claim path.

Also note: the migration shipped as `20260819130000_promo_materials_authorizations.sql` and the live-DB suite as `2g` → `2h-promo-materials-authorization.mjs`, because §2/§8's identifiers collided with the concurrent business-locations RLS/FK work.

## 11. Open items requiring Dan's review

- **Legal**: the Business Terms language above is provided by the spec, but this is legal copy — Dan (or counsel) should confirm the added clarifying sentence and the ES/KO translations.
- **Version bump consequence**: current policy never re-prompts existing businesses on a terms version bump (the gate is version-agnostic). If Dan wants existing businesses to see the updated terms, that is a separate, explicitly-scoped change — do not sneak it into this task.
- **Pre-existing bug (out of scope, flag only)**: location-cap INSERT policies (`20260630123000`, `20260807130000`) join `business_profiles.id = business_locations.business_id`, which appears to mismatch (`business_id` FKs `businesses.id`). Worth a separate audit.
- Multi-location future: the schema is per-location already; the settings UI can stay single-location until a real location manager UI exists.
