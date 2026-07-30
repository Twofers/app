# Founder Security Hardening Plan — 2026-07-29 (v2, post-verification)

**Status: REPOSITORY IMPLEMENTATION AND APPROVED EDGE ACTIVATION COMPLETE;
FOUNDER/PROVIDER ACTIONS PENDING.**

The three explicitly approved zero-cost production secrets and ten separately
approved migrations were configured/applied on 2026-07-29. The separately
approved 28-function founder/rate-limit activation was deployed and smoke-probed
on the same date. Secret values were not recorded. No website, DNS, paid add-on,
provider account, or merge was changed. Remaining controls require their
separately approved provider actions.

**Bootstrap budget decision — approved 2026-07-29:** added recurring cost must
remain $0 while the business has no customers. PITR, the Supabase custom
hostname, paid Vercel/GitHub features, a paid static runner, and physical
security-key purchases are deferred. Free TOTP/platform passkeys and a
free-tier separate immutable backup are the launch posture. No paid add-on may
be enabled without a new explicit cost approval.

Bootstrap security alerts will use the separately controlled
`unvmex2@hotmail.com` mailbox, as selected by Dan.

## 2026-07-29 execution reconciliation

- The remaining-item evidence and authority ledger is maintained in
  `docs/security/founder-security-completion-matrix.md`.
- Recovered the July 13 audit and atomic-rate proposal. Canonical dispositions:
  `docs/security/july-13-audit-disposition-2026-07-29.md`.
- Generated the current 78-function public-surface inventory, 103-name
  secret/config inventory, and live-checked all five Storage buckets.
- Applied the ten separately approved migrations through `20260824140000` and
  confirmed local/production migration parity.
- Completed the signed-in, read-only Supabase dashboard review. The Free plan
  has no scheduled backups. Security Advisor initially reported 2 errors and
  171 warnings;
  the two error-level views were absent from source control, and an anonymous
  probe confirmed that `deal_stats` exposed 14 metric rows. The separately
  approved zero-cost `20260824131000` remediation is now live: both views are
  security-invoker/service-role-only, both return 401 to anon, and Security
  Advisor reports 0 errors. The separately approved `20260824132000` migration
  also removed two redundant public-bucket listing policies: anon enumeration
  now returns zero entries, real logo/poster objects still return HTTP 200, and
  Advisor then reported 0 errors and 169 warnings. The separately approved
  `20260824133000` migration pinned all 25 audited mutable function search paths;
  parity and representative service-role/anon RPC smoke tests passed, and
  Advisor now reports 0 errors and 144 warnings.
- Deployed the separately approved 28-function activation batch. All targets
  advanced one version and remained active; `admin-business-name-requests` and
  `admin-reports` retained `verify_jwt = true`, while the other 26 retained
  `verify_jwt = false`. Anonymous smoke probes returned only expected 4xx
  responses, and all six private rate-limit table/RPC probes returned 401.
- Found two active owner rows; one has MFA disabled. Dan selected
  `unvmex2@gmail.com` as the sole founder identity on 2026-07-29. Its verified
  production UUID will be configured only as a hosted secret, not hard-coded.
  The second owner remains unchanged until founder login is proven.
- Corrected stale plan claims: promo owner-read, deals SELECT drift, and Stripe
  dispute handling were already fixed/applied; no duplicate work was shipped.
- Added founder-only/AAL2 centralized guards, mandatory MFA, reversible-only
  dashboard lifecycle, fresh-TOTP checks, an eight-hour sealed cookie session,
  external alerts, and atomic abuse ceilings.
- Added immutable backup/restore tooling, an all-refs encrypted repository
  mirror, pinned Actions, verified gitleaks checksum, Dependabot, and CodeQL.
- Safe npm remediation cleared the critical advisory. Remaining production
  findings require an unsafe Expo/React Native major upgrade and are documented
  separately.

Supersedes the 2026-07-28 audit/plan draft. That draft was verified against the repo on
2026-07-29: every factual claim checked out, but it missed whole surfaces (Stripe, the
app-distribution chain, the wider secret estate) and re-proposed several protections that
already exist. This version folds all of that in.

**Standing rules (unchanged):**
- Dan keeps unrestricted founder access to all dashboard information and normal operations.
  Extra friction applies only where one stolen session could permanently delete data, change
  ownership, disable security, or lock the founder out.
- Every production migration, function deploy, website deploy, DNS change, secret rotation,
  and paid-plan activation is a separate approval point.
- `[DAN]` items need the founder (provider dashboards, payments, MFA enrollment — the
  developer must never handle founder credentials). `[DEV]` items the developer can do
  independently. Dan-only items are also collected in one batch list at the end so his time
  is used in one sitting per phase.

---

## Verified baseline before this implementation pass (2026-07-29)

Confirmed good (live-probed by the audit, or statically verified in-repo):

- All 24 admin functions enforce `admin_users` membership + active status + role
  permissions. 22 use shared `requireAdmin`
  (`supabase/functions/_shared/admin-prospects.ts:140`); 2 carry inline copies:
  `admin-account-management/index.ts:769` and `admin-dashboard-summary/index.ts:1945`.
- Admin login throttling exists: DB-backed, 8 attempts / 15 min
  (`admin-auth-session/index.ts:149,326`).
- Admin MFA enforcement exists but is **conditional** on `admin_users.require_mfa`
  (`_shared/admin-mfa.ts`; aal2 check at each guard site).
- Strict CSP already on `/admin` (`website/vercel.json` — `script-src 'self'`,
  `frame-ancestors 'none'`; no third-party scripts possible). `/admin` still lacks
  `Cache-Control: no-store`.
- Append-only (for client roles) `admin_audit_log` with denied-access logging
  (migration `20260730125000`).
- `admin_account_protected` guard blocks deleting the admin account through the normal
  workflow (`admin-account-management/index.ts:134`).
- Stripe webhook verifies signatures (`constructEventAsync`) and checks
  `STRIPE_EXPECTED_LIVEMODE`.
- DDL revoke migration applied (`20260820122000`); old backup-table RLS gap closed
  (`20260712120000:349`).
- Only `.env` *examples* are tracked in git. GitHub secret scanning + push protection on.
  Namecheap transfer lock on. Defender/firewall on.

Confirmed weaknesses (carried from the audit, all re-verified where checkable):

- No verified restore point: `pitr_enabled: false`, no backups visible via API.
- Supabase project deletion is permanent and total.
- DB reachable from every IP, SSL enforcement off.
- Permanent account deletion executes immediately from the web dashboard
  (`admin-account-management/index.ts:457`).
- Admin access/refresh tokens in `localStorage`/`sessionStorage`
  (`admin-login.js:128`, `admin-shell.js:101`).
- Repo `Twofers/app` is PUBLIC; `main` unprotected (no force-push/deletion block, no
  required checks, no Dependabot/CodeQL).
- Two open Google API-key alerts (mobile client config — restrictions unverified).
- DNSSEC off; DMARC `p=none`.
- Stale QA credentials → the authenticated RLS / cross-tenant probe has NOT run recently.
- `npm audit --omit=dev`: 1 critical / 23 high / 14 moderate (mostly Expo transitive).

Corrections to the prior draft:

- ~~"Fix login throttling"~~ — throttling already exists. The real item is **mandatory MFA**:
  flip `require_mfa = true` on every `admin_users` row and force TOTP enrollment at login.
- ~~"Apply Cache-Control/Referrer-Policy and lock down admin scripts"~~ — CSP and
  Referrer-Policy already exist; only `no-store` on `/admin` is missing.

---

## Phase 0 — Reconcile and inventory (no prod changes) `[DEV]`

Cheap, do first; later phases depend on these lists being true.

- [x] Recover the 2026-07-13 branch security audit (37 findings; branch never pushed).
      Both the audit and proposed atomic-rate SQL were present; dispositions are in
      `docs/security/july-13-audit-disposition-2026-07-29.md`.
- [x] Build the **public-surface inventory**: all 78 current `verify_jwt = false` functions
      (`supabase/config.toml:390-554`). One row each: function → auth mechanism
      (user JWT checked in-function / `x-cron-secret` / signed token / deliberately public)
      → abuse-rate protection. Spot-checks already clean: `delete-user-account`,
      `stripe-webhook`, cron functions. Flag the anonymous-write endpoints
      (`ingest-analytics-event`, `qr-campaign-redirect`) for flood review.
- [x] Build the **secrets inventory with owners**: 103 names referenced by the security runtimes
      (STRIPE_*, OPENAI_API_KEY, GEMINI_API_KEY, RESEND_API_KEY,
      GOOGLE_WALLET_SERVICE_ACCOUNT_JSON, APPLE_PASS_*_PEM_B64, GOOGLE_PLACES_API_KEY,
      CRON_SECRET, QR_SCAN_IP_HASH_SECRET, …). For each: where it's minted, how to revoke,
      how to re-issue during disaster recovery.
- [x] `supabase migration list --linked` — confirmed no repo↔prod migration drift before any
      schema work.
- [x] Query `admin_users`: list rows where `require_mfa` is false, and any
      account besides the founder with role `owner`/`admin`. Two active owners
      exist; Dan selected `unvmex2@gmail.com` as founder. Remediate the other
      only after the selected founder completes the approved activation.
- [x] Sweep for **deployed-but-uncommitted / unpushed work**. The recovery backlog and
      267-branch/29-worktree snapshot are recorded in
      `docs/security/repository-recovery-invariant.md`. Anything not pushed does not survive. Establish the
      standing invariant: *deployed == committed == pushed*, checked before every deploy.

## Phase 1 — Make catastrophic deletion recoverable (highest priority)

- [ ] `[DAN]` Open Supabase → Backups page; record what actually exists (API says none).
- [x] `[DAN]` 7-day PITR decision recorded: defer the ~$100/mo add-on while
      there are no customers and a 24-hour recovery point is acceptable.
      Reconsider when one day of loss would materially harm customers or cost
      more than the add-on.
- [x] `[DEV]` Independent encrypted `pg_dump` daily tooling/workflow (includes `auth` schema), from a runner
      whose credentials a stolen Supabase account cannot revoke retroactively.
- [x] `[DEV]` Back up every Storage bucket separately (DB backups exclude file bytes):
      all five live buckets are enumerated dynamically and checksummed.
- [ ] `[DAN]` Create the **separate-provider, separate-account** free-tier
      Backblaze B2 destination with Compliance Object Lock and lifecycle
      expiry. Bootstrap retention is 7 daily / approximately 3 monthly, with a
      900 MB archive ceiling to stay below the free 10 GB allowance.
- [x] `[DEV]` Config inventory backup tooling: Auth settings, bucket config,
      cron jobs, webhooks, DNS zone export, deployed function versions, **and** the
      Phase-0 secrets inventory.
- [ ] `[DAN+DEV]` **Secrets VALUES vault** (new in v2): encrypted offline copy of secret
      values, or a per-key re-issue runbook. Names alone cannot meet a 4-hour restore
      target — a fresh project needs ~60 secrets re-minted. Outside-Git encrypted
      vault creation/verification tooling is ready; founder population and offline
      verification remain.
- [ ] `[DAN]` EAS credential export (Android keystore, iOS certs) into the same vault —
      losing these means losing the ability to ship app updates (new in v2).
- [ ] `[DAN+DEV]` Quarterly restore drill into a disposable Supabase project: DB + Auth login +
      sample Storage objects + at least one Edge Function with re-minted secrets. A backup
      is not valid until restored. The destructive DB gate and automated
      Storage/Auth/Function verifier are ready; the drill still needs a
      founder-provisioned disposable project and an actual backup.
- [ ] Bootstrap targets: independent-backup RPO ≤ 24 h; website RTO 4 h; full
      app/backend RTO measured during the first drill. PITR/minute-level RPO is
      deferred with its paid add-on. Success-heartbeat/failure hooks are staged;
      measured evidence awaits the first approved run.

## Phase 2 — Provider account takeover hardening (expanded in v2)

The prior draft covered Supabase/GitHub/Vercel/Namecheap/Cloudflare. These are peers in
blast radius and were missing:

- [ ] `[DAN]` **Stripe**: enable MFA + store recovery offline; alert on payout-bank
      changes; replace the raw secret key with **restricted keys** per function group
      (webhook events aren't editable in the Workbench UI — use a Write-scoped restricted
      key, see `reference_stripe_webhook_events_not_editable_in_ui`); rotate the webhook
      signing secret; review Radar.
- [x] `[DEV]` `charge.dispute.created` handling was already implemented, deployed, and
      subscribed at the live webhook endpoint; the original note was stale.
- [ ] `[DAN]` **Apple Developer** account: MFA, recovery, membership audit
      (App Store app `ascAppId 6765769303`).
- [ ] `[DAN]` **Google Play Console**: MFA, membership audit; locate and secure the Play
      service-account JSON currently on the dev machine; restrict its scopes.
- [ ] `[DAN]` **Expo/EAS** account: MFA; audit tokens/sessions; this account holds the
      Android signing keystore — treat like a signing authority.
- [ ] `[DAN]` **Founder Google account** (root of trust for Play, Google Cloud,
      recovery paths): use free platform passkeys/TOTP now and remove SMS
      fallback (SIM-swap); purchase two hardware keys only after a separate
      future cost approval.
- [ ] `[DAN]` **OpenAI + Gemini**: provider-side hard spend caps + billing alerts
      (in-app quota exists but is not a provider cap); rotation procedure into the vault.
- [ ] `[DAN]` **Resend**: MFA; key rotation procedure (a stolen key sends phishing as
      twoferapp.com).
- [ ] `[DAN]` **Google Cloud project**: audit the wallet service account + Places/Maps API
      keys (closes the two open key alerts — verify app + API restrictions).
- [ ] `[DAN]` Original set: Supabase org members + MFA (second TOTP factor stored
      offline — Supabase has no recovery codes); Vercel MFA + token audit; Namecheap +
      Cloudflare hardware-backed MFA; recovery email that does not depend on
      twoferapp.com.

## Phase 3 — Founder-only admin authorization + destructive-action friction `[DEV]`

- [x] **Centralize the guard first**: all admin function guards now route through
      (`admin-account-management`, `admin-dashboard-summary`) into shared `requireAdmin`
      so founder-pinning lands in exactly one place (aligns with ops-console redesign
      Phase 0). Without this, the two most dangerous endpoints can drift.
- [x] Production rule staged in the shared guard: caller UUID == configured founder UUID **and** active
      `admin_users.role = 'owner'` **and** aal2. Non-owner roles → 403 regardless of UI.
- [x] Mandatory MFA migration applied: every `admin_users` row now has
      `require_mfa = true`. The approved `admin-auth-session` deployment now
      forces TOTP enrollment/verification at login (replaces the draft's stale
      "fix login throttling" item — throttling already exists).
- [x] Founder account cannot be disabled, demoted, MFA-reset, or deleted via dashboard
      (deletion guard already exists — extend to the other three).
- [x] Remove immediate permanent deletion from the dashboard. Keep archive + suspension
      (already reversible: archive bans + cancels Stripe but preserves data).
- [x] No admin deletion path remains. If later legally required, build a delayed deletion queue: recent MFA re-verify, exact-email
      confirmation, 7–30 day cancellation window, external alert, **no bulk path**, hard
      per-day cap so a stolen session cannot mass-erase.
- [x] Keep customer-initiated deletion (`delete-user-account`) working; rate-limit it and
      keep it isolated from admin bulk operations.
- [x] Stage admin-action alerts to the founder's separate address on: login,
      MFA change, any lifecycle action (`ADMIN_ALERT_EMAIL` plumbing already exists) — the
      DB audit log alone can be erased by a full service-key compromise; external copies
      cannot.

## Phase 4 — Supabase control plane `[DEV builds, DAN approves each prod change]`

- [ ] Enable SSL enforcement (test project first).
- [ ] Restrict direct Postgres/pooler access to a trusted static VPN/IP + the backup
      runner. (HTTPS APIs and Edge Functions are unaffected.)
- [ ] Rotate the DB password after restrictions verified.
- [ ] Inventory + revoke old Supabase personal access tokens; remove persistent prod CLI
      access from the daily-use machine when maintenance ends.
- [ ] Close the Security Advisor/deep catalog gate. The signed-in review and
      CLI advisor scan are complete: the initial 2 errors and 171 warnings are
      recorded in
      `docs/security/supabase-security-advisor-snapshot-2026-07-29.json`.
      `public.deal_stats` was anonymously readable (14 rows) and both
      error-level views were untracked production drift. The separately
      approved `20260824131000_harden_legacy_reporting_views.sql` now recreates
      both as security-invoker/service-role-only views at $0. Post-apply probes
      return 401 for both anon endpoints and Advisor reports 0 errors. Triage
      the remaining 144 warnings by reachability before changing grants or
      Auth/Storage settings. The first triage is recorded in
      `docs/security/supabase-security-advisor-warning-triage-2026-07-29.md`.
      The separately approved $0 migration `20260824132000` removed the two
      redundant public-bucket listing policies. Anon listings now expose zero
      entries, public object delivery remains HTTP 200, and the related Advisor
      warnings are closed.
      All 25 functions reported for mutable `search_path` were then audited
      against their live definitions and exact signatures. The separately
      approved zero-cost migration
      `20260824133000_pin_remaining_function_search_paths.sql` is now applied.
      It only pins existing function name resolution to `pg_catalog, public`;
      it does not change function bodies, signatures, ownership, grants, or
      data. Parity and representative service-role/anon RPC smoke tests passed;
      Advisor now reports 0 errors, 144 warnings, and zero mutable-search-path
      findings.
      Live catalog triage then identified 13 `SECURITY DEFINER` functions that
      return `trigger`, each has one live trigger binding, and none has a direct
      application RPC caller. The separately approved zero-cost migration
      `20260824134000` revoked only their direct `PUBLIC`, `anon`, and
      `authenticated` execution. Post-apply checks confirmed all 13 trigger
      bindings remain enabled, service-role execution remains, both client
      roles have zero catalog execution privileges, and all 13 anon RPC routes
      return HTTP 404. Parity is exact and Advisor now reports 0 errors and 118
      warnings.
      Twenty-two remaining functions have explicit service-role-only
      repository grant contracts and only trusted Edge/cron/internal callers,
      but the live catalog still granted both client roles. The separately
      approved zero-cost migration `20260824135000` removed only that client
      execution drift. Catalog verification shows zero client execution and
      retained service-role execution for all 22; all anon routes are denied
      and 11 representative trusted read-only RPCs return HTTP 200. Parity is
      exact and Advisor now reports 0 errors and 74 warnings.
      The next live-catalog and policy audit classified 24 more functions as
      non-public while preserving authenticated/service-role use. Seven
      functions required by anonymous policies or product flows were explicitly
      excluded. The separately approved zero-cost migration `20260824140000`
      revoked only `PUBLIC`/`anon` execution. Catalog verification shows zero
      anonymous execution and retained authenticated/service-role execution for
      all 24; all 24 removed anon routes return HTTP 401, all seven intentional
      public RPCs return HTTP 200, and 15 representative trusted read-only RPCs
      return HTTP 200. Parity is exact and Advisor now reports 0 errors and 50
      warnings.
      Six remaining authenticated findings are internal helpers reached only by
      one `pg_cron` job, trusted service-role Edge code, or internal
      `SECURITY DEFINER` trigger functions. They have no authenticated policy
      dependency or mobile/website caller. Zero-cost migration
      `20260824141000` is staged with a three-test gate to remove direct client
      execution while preserving service-role/internal paths, bodies,
      signatures, jobs, triggers, and data. Production remains separately
      approval-gated; the expected Advisor result is 0 errors and 44 warnings.
      Leaked-password protection is explicitly deferred because it requires
      Supabase Pro (currently starting at $25/month).
      The deep grant check passed: `PUBLIC`, `anon`, and `authenticated` hold no
      TRUNCATE/TRIGGER/REFERENCES privileges on public-schema relations.
- [ ] **GoTrue hardening** (new in v2): leaked-password protection, auth rate limits,
      OTP expiry, captcha decision, SMTP sender review.
- [ ] Refresh throwaway QA credentials; rerun the authenticated RLS, cross-tenant, and
      normal-business-rejection probes (currently blocked by stale creds — the anon-only
      probe is backstopped by the static guard check but must be closed properly).
- [ ] Decide `demo@demo.com`'s fate (reviewer account with known creds in prod; teardown
      is currently sequenced behind the reviewer-account build).
- [x] Earlier RLS defects were stale: promo owner-read was fixed/applied by
      `20260819140000`; deals-SELECT drift by `20260812130000`.

## Phase 5 — Admin session hardening (website)

- [x] `[DEV]` Add `Cache-Control: no-store` to `/admin(.*)` now (one-line vercel.json
      change; CSP/Referrer-Policy already exist — do not rebuild them).
- [ ] `[DAN]` Move admin console to `admin.twoferapp.com` behind Cloudflare Access
      (founder identity only).
- [x] `[DEV]` Replace browser-stored Supabase tokens with a same-origin backend session:
      opaque `HttpOnly; Secure; SameSite=Strict` host-only cookie; refresh tokens
      encrypted server-side; remove "Remember me".
- [x] `[DEV]` Fresh TOTP for destructive/security-sensitive actions.
- [x] `[DEV]` Document and enforce in the release runbook: no auto-deploy of the admin site from an unprotected branch — exact reviewed
      commit, manual promotion.

## Phase 6 — GitHub, Vercel, DNS, email

- [ ] `[DAN]` Decide repo visibility (currently PUBLIC — full backend + admin design
      exposed; note making it private does NOT scrub history, and gitleaks CI already
      guards new commits).
- [ ] `[DAN]` Protect `main` (include administrators): block force-push + deletion,
      require CI/tests/secret-scan/security gates.
- [x] `[DEV]` Stage Dependabot configuration + CodeQL; pin GitHub Actions to commit
      SHAs; verify downloaded tool checksums.
- [ ] `[DAN]` Approve/merge the staged GitHub controls and enable live Dependabot
      security updates. The read-only snapshot currently shows the repository
      setting disabled; CodeQL is not live until its workflow reaches `main`.
- [ ] `[DAN]` Replace the broad classic GitHub token with fine-grained/hardware-backed
      access.
- [x] `[DEV]` Stage an encrypted repo mirror outside GitHub that includes local-only
      branches; activation waits for the separate backup account.
- [ ] `[DAN]` Vercel: manual production promotion; alerts on deploys/domain/env/member
      changes.
- [ ] `[DAN]` DNS/email: auto-renew + backup payment verified; DNSSEC (confirm
      Namecheap↔Cloudflare DS process first); DMARC `p=none` → `quarantine` → `reject`
      only after Cloudflare Email Routing + Resend SPF/DKIM verified.

## Phase 7 — The machine itself (new in v2) `[DAN]`

- [ ] Verify BitLocker full-disk encryption on the dev machine (the read-only command
      was access-denied; rerun elevated per the founder operations runbook).
- [ ] Sweep local secret files: filename/tracked-state inventory is complete; Dan must identify,
      minimize, and vault `.env.development.local`, Play service-account JSON,
      gh token, EAS session, adb keys — inventory, minimize, vault the rest.
- [ ] Password manager for all provider logins; no browser-stored passwords for the
      founder accounts.

## Phase 8 — Backend portability (future app release)

- [x] `[DAN]` Supabase custom hostname cost decision recorded: defer
      `api.twoferapp.com` while the zero-added-cost bootstrap policy applies.
- [ ] `[DEV]` Point app + website at it; test Auth callbacks, Storage, Functions,
      Google + Apple sign-in; document attach-to-restored-project procedure.
      (Until this ships, a replacement project forces a new store release.)

## Phase 9 — Dependencies + exercise

- [x] `[DEV]` Triage npm audit (measured 1 critical / 63 high / 9 moderate before the safe fix) without forcing an
      unsafe Expo major upgrade; separately review Deno/esm.sh imports in Edge Functions
      (npm audit does not see them).
- [ ] `[DAN+DEV]` Simulated takeover + recovery exercise; write the incident runbook from
      what it teaches (revocation order: sessions → keys → tokens → DNS).

---

## Execution order

1. Phase 0 (inventories — everything else depends on them)
2. Phase 2 provider MFA/recovery `[DAN batch #1]`
3. Phase 1 backups + first restore drill
4. Phase 3 founder-only authorization + delete friction
5. Phase 5 session hardening (no-store immediately; cookie backend after Phase 3)
6. Phase 4 control plane (SSL/IP/rotation/probes)
7. Phase 6 GitHub/Vercel/DNS/email
8. Phases 7–9

## Dan-only batch list (do in one sitting each)

**Batch #1 (unblocks everything):** Supabase Backups page check; MFA +
recovery on Supabase, Stripe, Apple Dev, Play Console, EAS, Vercel, Namecheap, Cloudflare,
founder Google (free passkey/TOTP, kill SMS fallback); create the free-tier
immutable backup account;
OpenAI/Gemini spend caps; repo private/public decision.

**Batch #2 (after dev work ready):** approve branch protection, Cloudflare Access setup,
admin subdomain DNS, SSL-enforce + IP-restrict go-live, DMARC steps, custom-hostname
purchase.

## Local verification record — 2026-07-29

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run typecheck:functions` — passed for all 159 Edge Function source files.
- `npm run check:website-supabase` — passed.
- `npm run check:website-ui` — passed after updating the dashboard bootstrap and crawler
  mocks for the sealed-cookie admin session.
- `npm test -- --run` — all 308 files / 2,150 tests passed, including the
  updated AI-poster lock after the explicitly approved instruction-file
  deletions, the reporting-view checks, and the four bucket-listing migration
  checks, plus the function search-path, trigger-execution, and
  service-role-only, non-public anonymous-execution, and internal-helper
  execution migration checks.
- Workflow and Dependabot YAML parsed successfully; no GitHub Action uses a floating
  `v*`, `main`, `master`, or `latest` reference.
- The ten separately approved migrations applied successfully; linked
  migration parity now matches through `20260824140000`.
- The separately approved 28 Edge Functions deployed successfully. Every
  version advanced, all 28 report `ACTIVE`, the two JWT-enforced functions
  retained `verify_jwt = true`, and anonymous endpoint smoke checks passed.
- The authenticated RLS smoke probe could not sign in because the saved
  throwaway shopper credentials are stale. The new anonymous live probe proved
  all three limiter tables and all three service-role RPCs exist and reject
  `anon` with HTTP 401. Four focused source-test files passed (22 tests).
- Linked database lint reported no error in the four new migrations. It
  repeated the intentional optional-table warning inside `purge_user_data` and
  exposed a pre-existing ambiguous `ON CONFLICT` reference in
  `check_business_location_trial_reuse`; neither received an additional
  unapproved fix migration.
- The read-only dashboard/CLI Advisor review initially recorded 2 errors and 171
  warnings. Both errors were untracked SECURITY DEFINER reporting views; anon
  could read 14 rows from `deal_stats`. The three-test static gate for the
  `20260824131000` service-role-only remediation passed. The separately
  approved migration is now applied, parity is confirmed, both anon probes
  return 401, and Advisor reports 0 errors. The deep catalog grant probe found
  zero unexpected TRUNCATE, REFERENCES, or TRIGGER grants for `PUBLIC`, anon,
  or `authenticated`.
- The separately approved `20260824132000` migration removed both broad
  Storage listing policies. Anon list calls return zero entries for
  `business-logos` and `deal-photos`; sampled public objects from both buckets
  still return HTTP 200 with non-empty bodies. Advisor dropped to 169 warnings.
- The separately approved `20260824133000` migration closed all 25 mutable
  function search-path findings. Service-role and current-anon read-only RPC
  smoke tests returned HTTP 200 with expected results; Advisor dropped to
  144 warnings with 0 errors.
- The separately approved `20260824134000` migration removed direct client
  execution from 13 trigger-only `SECURITY DEFINER` functions. All 13 live
  trigger bindings and service-role execution remain; all 13 anon RPC routes
  return HTTP 404. Advisor dropped to 118 warnings with 0 errors.
- The separately approved `20260824135000` migration removed client execution
  from 22 service-role-only functions. Catalog access is correct, all anon
  routes are denied, and 11 representative trusted read-only RPCs return HTTP
  200. Advisor dropped to 74 warnings with 0 errors.
- The separately approved `20260824140000` migration removed anonymous
  execution from 24 non-public functions while preserving authenticated and
  service-role access. All 24 removed anon routes return HTTP 401, all seven
  intentional public RPCs and 15 representative trusted read-only RPCs return
  HTTP 200. Advisor dropped to 50 warnings with 0 errors.
- Control-plane snapshots now record: the Free plan supplies no scheduled
  database backups, no physical backup/PITR exists, SSL enforcement
  false, database CIDRs open to all IPv4/IPv6, the three approved Edge secret
  names present, public GitHub visibility with no protection/ruleset and live
  Dependabot security updates disabled, no DNSSEC delegation, and DMARC
  `p=none`.
- `git diff --check` — passed (line-ending notices only).
- No website/DNS deploy, unrelated provider-console change, paid-plan
  activation, merge, or app release was performed. Production mutations were
  limited to the separately approved three-secret configuration, six
  migrations, and 28 Edge Function deployments.
