# Founder Security Hardening Plan — 2026-07-29 (v2, post-verification)

**Status: REPOSITORY IMPLEMENTATION AND APPROVED EDGE ACTIVATION COMPLETE;
FOUNDER/PROVIDER ACTIONS PENDING.**

The three explicitly approved zero-cost production secrets and twelve separately
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

## What remains (plain-English status, updated 2026-07-29)

**Checklist progress: 35 completed / 32 remaining (recounted directly from the
checkboxes, 2026-07-30; earlier "29/35" and "34/32" figures in this file's history
were estimates and were wrong).** Both staged migrations were applied to
production on 2026-07-30, closing the `business_locations` item. See "Why this
plan cannot reach 100% from the repository" below for the item-by-item gate audit:
20 of the remaining 32 need a founder provider credential, and the rest need a
provider account that does not exist yet, a production approval, a founder
decision, or a deferred cost approval. The database migrations, Edge Function activation, admin-session code
hardening, test-project SSL enforcement, direct-client TLS validation,
authenticated RLS/cross-tenant probes, the named Advisor reachability triage, the
GoTrue change specification, and the takeover-exercise worksheet are complete.
**No developer-only item remains open.** Everything left needs a founder
credential, a provider console, or an explicit production approval — plus the two
new findings below, which are staged and waiting on approval rather than on work.

| Remaining group | Items left | Who must act | Added recurring cost |
| --- | ---: | --- | --- |
| Backups and recovery | 6 | Founder creates the separate free B2 account and vault; joint first restore drill | $0 on the stated B2 free-tier ceiling |
| Provider MFA, recovery, keys, and spend controls | 9 | Founder signs in to Stripe, Apple, Google, Expo, OpenAI/Gemini, Resend, Supabase, Vercel, registrar, and Cloudflare | $0 for MFA/passkeys and reviews |
| Supabase production control plane | 5 | Founder approves each production setting; direct-client validation is now done | $0, except the already-deferred leaked-password add-on |
| **New findings awaiting approval** | 2 | Apply the staged `business_locations` policy fix; diagnose the founder hotmail identity | $0 |
| Admin site, GitHub, Vercel, DNS, and email | 7 | Founder choices/approvals and provider-console changes | $0 where provider free tiers permit |
| Founder machine and recovery exercise | 3 | Founder vaults local credentials and verifies device protection; joint recovery drill | $0 |
| Future custom-hostname portability | 1 | Deferred until a separate cost decision | Not approved |

### Why this plan cannot reach 100% from the repository

Audited item by item on 2026-07-29 (second pass). Every remaining box falls into
exactly one of five gates, none of which a developer can open:

| Gate | Items | What specifically is missing |
| --- | ---: | --- |
| Founder provider credential or console change | 20 | Phase 2's nine provider MFA/recovery/spend items; the admin subdomain behind Cloudflare Access; `main` protection, the staged GitHub controls, the GitHub token, Vercel promotion/alerts, DNS/DNSSEC/DMARC; Supabase PAT revocation; BitLocker, local secret vaulting, password manager; diagnosing the founder hotmail identity. The developer must never hold these credentials. |
| A provider resource that does not exist yet | 6 | The separate free-tier B2 account, the populated secrets-values vault, the EAS credential export, and the disposable Supabase project. Without them there is no backup object to verify and no restore target, so the drill, the RPO/RTO targets, and the takeover exercise cannot run — only their tooling and worksheets exist. |
| Production write approval | 2 | DB password rotation, and the Advisor gate's remaining sub-parts. The two staged migrations were **applied 2026-07-30**. |
| Founder decision, not work | 3 | Repo public/private; `demo@demo.com`'s fate; whether to accept option 2 for IP restriction. (`validate_business_invite` is a sub-decision inside the Advisor gate.) |
| Deferred on cost, by standing policy | 1 | Pointing the app/website at `api.twoferapp.com`, which was never purchased. PITR, leaked-password protection, and static egress are recorded as deferrals inside other items rather than as separate boxes. |

Two consequences worth stating plainly rather than leaving implicit:

- **The plan's own structure caps developer completion below 100%.** 20 of the 33
  remaining items need a credential the developer is explicitly forbidden to hold,
  and 6 more need an account that does not exist. "Complete the plan" is not a
  task a developer can finish; the correct developer end-state is what now holds —
  no item blocked on work.
- **One remaining `[DEV]` item is blocked by a deferred cost decision, not by
  effort.** Phase 8's "point app + website at `api.twoferapp.com`" cannot start
  because the custom hostname was deliberately not purchased. It should read as
  deferred, not pending.

### The push hold is now released — 2026-07-30

`Twofers/app` is **public** with no `main` protection
(`docs/security/github-control-plane-snapshot-2026-07-29.json`), so this branch
was deliberately held unpushed while it described an unpatched exposure. Both
migrations are now applied, so the hold no longer applies and the Phase-0
invariant *deployed == committed == pushed* should be restored by pushing
`codex/founder-security-hardening`.

Until it is pushed, this work exists only on the founder machine and is not
protected against disk loss. Note the residual disclosure consideration: the
branch still documents the exposure in detail, and while the fix is applied, the
production-side confirmation above is inference rather than measurement. Making
the repository private — a Phase 6 decision that is already outstanding — removes
the question entirely.

### Applied to production — 2026-07-30

| Change | Effect | Verified |
| --- | --- | --- |
| `20260824143000_remove_pilot_business_location_read_policy.sql` | Drops the untracked pilot policy behind the cross-tenant read exposure | Parity exact; anon reads still `[]`; public catalog intact. **Whether the policy was present in production is still unconfirmed** — the drop was `IF EXISTS` |
| `20260824144000_revoke_nested_definer_helper_client_execute.sql` | Removes client EXECUTE from three definer-only helpers | All three now 401/`42501` to anon; wrappers and public RPCs still 200; edge functions healthy. The `authenticated` half and the 40-warning Advisor count remain unverified |

### Still staged, waiting on approval

| Change | Effect | Cost |
| --- | --- | --- |
| `BACKUP_DB_ROOT_CERT_PEM` repository secret | Moves direct database connections from encrypted-only to authenticated | $0 |

### Important cost deferrals

- Supabase PITR (about $100/month), leaked-password protection ($25/month),
  and the Supabase custom hostname are **not** part of the zero-cost bootstrap
  completion path. They stay off unless separately approved.
- Two zero-cost migrations are now staged and waiting for approval
  (`20260824143000`, `20260824144000`). Both are drop/revoke-only.
- The direct-client validation gate is closed. Production SSL, IP restrictions,
  password rotation, and token revocation each remain separate approvals.

## 2026-07-29 execution reconciliation

- The remaining-item evidence and authority ledger is maintained in
  `docs/security/founder-security-completion-matrix.md`.
- Recovered the July 13 audit and atomic-rate proposal. Canonical dispositions:
  `docs/security/july-13-audit-disposition-2026-07-29.md`.
- Generated the current 78-function public-surface inventory, 103-name
  secret/config inventory, and live-checked all five Storage buckets.
- Applied the twelve separately approved migrations through `20260824142000` and
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

- [x] `[DAN]` Open Supabase → Backups page; record what actually exists (API says none).
      Recorded and cross-checked from two sources: the signed-in dashboard review
      of 2026-07-29 reports "Free Plan does not include project backups", and
      `supabase backups list` returns `backups: null`, empty
      `physical_backup_data`, and `pitr_enabled: false`
      (`docs/security/supabase-control-plane-snapshot-2026-07-29.json`,
      `supabase-security-advisor-snapshot-2026-07-29.json`). There is no
      provider-side restore point of any kind. That is the finding this item
      existed to establish, and it is what makes the independent backup the only
      recovery path.
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

- [x] Enable SSL enforcement on the separate `twofer testing` project
      (`zsuzrerdailvylccqtds`). The dashboard confirms the setting is checked
      and the project returned to `ACTIVE_HEALTHY`; production was not changed.
- [x] Validated every direct test-database client against the SSL-enforced test
      project. Evidence:
      `docs/security/direct-database-client-tls-validation-2026-07-29.md`.
      Two read-only tools were added (`scripts/security/verify-database-tls.mjs`,
      `scripts/security/pg-read.mjs`). Findings: the `db.<ref>` endpoints are
      IPv6-only and unreachable from the founder machine, so every direct client
      uses the IPv4 pooler; the pooler refuses every cleartext Postgres startup
      on both projects and both ports, so no reachable client can be using
      cleartext today; the Supabase CLI and a raw libpq-style client both
      complete authenticated round trips against the enforced test project. Two
      cautions are recorded rather than glossed: those cleartext refusals are the
      pooler's own behavior and do not by themselves prove a per-project setting,
      and the CLI ignores `sslmode` entirely — even `verify-full` succeeds
      against a certificate the trust store rejects. **Production SSL enforcement
      is now unblocked and remains a separate founder approval.**
- [x] `[DEV]` Direct-client TLS upgraded from encrypted-only to authenticated
      where possible: the backup and restore scripts now switch to
      `PGSSLMODE=verify-full` with `PGSSLROOTCERT` when `BACKUP_DB_ROOT_CERT`
      is supplied, and fail closed if it is set but unusable. Founder step:
      store the Supabase database CA as the `BACKUP_DB_ROOT_CERT_PEM` secret.
- [ ] Restrict direct Postgres/pooler access to a trusted static VPN/IP + the backup
      runner. (HTTPS APIs and Edge Functions are unaffected.)
      **Feasibility analysed 2026-07-29 — this item cannot be done as written on
      the current $0 architecture, and should not be approved until it is
      rescoped.** Live state reconfirmed: `db_allowed_cidrs` is `0.0.0.0/0`,
      IPv6 `::/0`, no network bans. The two clients that would need allowlisting
      have no stable address:
      (a) the backup workflow runs on `ubuntu-latest`, a GitHub-hosted runner
      whose egress comes from GitHub's published Actions ranges — those rotate,
      and allowlisting them all would admit any GitHub customer's runner, which
      is worse than security theatre because it looks like a control;
      (b) the founder machine has a dynamic residential address.
      So an allowlist today either breaks the nightly backup or grants a range
      broad enough to be meaningless. Three rescoping options, cheapest first:
      1. **Self-hosted runner on the founder machine** ($0) — makes the backup's
         egress the same address as the founder's, but that address still moves
         and the machine must be awake at 08:23 UTC. Weak.
      2. **Leave `0.0.0.0/0` and rely on the other controls** — SSL enforcement,
         a rotated strong password, and `verify-full` certificate pinning. This
         is the honest $0 posture, and it is what is in force today.
      3. **Static egress** (paid: a small VPS or NAT gateway for the runner)
         — the only option that makes an allowlist real. Needs a separate cost
         approval, same as the already-deferred paid static runner.
      Recommendation: adopt option 2 explicitly and mark this item deferred
      rather than pending, so it stops reading as outstanding work. Option 3
      returns as a cost decision alongside PITR.
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
      dependency or mobile/website caller. The separately approved zero-cost
      migration `20260824141000` removed their direct client execution while
      preserving service-role/internal paths, bodies, signatures, jobs,
      triggers, and data. Catalog verification shows zero client execution and
      retained service-role execution for all six; the cleanup cron job remains
      active, all four dependent triggers remain enabled, all six anon routes
      are denied, and four representative trusted read-only RPCs return HTTP
      200. Parity is exact and Advisor now reports 0 errors and 44 warnings.
      One remaining authenticated finding, `user_owns_business_location`,
      accepts an explicit user ID but has no direct mobile/website or RLS-policy
      caller. Its only callers are four trusted service-role billing Edge
      functions and `get_location_billing_summary`. The separately approved
      zero-cost migration `20260824142000` removed direct client execution
      while preserving service-role and nested-definer use, bodies, signatures,
      and data. Catalog verification shows zero client execution and retained
      service-role execution; the anonymous RPC route returns HTTP 401 and the
      service-role RPC returns HTTP 200. Parity is exact and Advisor now
      reports 0 errors and 43 warnings.
      **Migration `20260824144000` applied to production 2026-07-30**, removing
      client execution from `admin_role()`, `business_member_role(uuid)`, and
      `get_runtime_billing_config()`. Post-apply verification: all three return
      HTTP 401 / `42501 permission denied for function` to anon, while the
      client-facing wrappers and public RPCs still return HTTP 200
      (`is_publicly_visible_business`, `public_local_businesses`,
      `customer_deal_poster_specs`, `customer_deal_localizations`), `gate:rls`
      reports no exposure, and all seven probed Edge Functions are healthy.
      Two verification gaps stay open, both needing something founder-held:
      (a) the `authenticated`-role half of the revoke is untested, because anon
      execution on these three was already removed by `20260824140000` and there
      is no working authenticated production identity to test with; and (b) the
      Advisor count is expected to read 40 warnings but that requires a signed-in
      dashboard to confirm.
      Still open inside this gate: the two unnamed function findings (they belong
      to functions the test project has not received), the
      `validate_business_invite` product decision, and leaked-password
      protection.
      Leaked-password protection is explicitly deferred because it requires
      Supabase Pro (currently starting at $25/month).
      The deep grant check passed: `PUBLIC`, `anon`, and `authenticated` hold no
      TRUNCATE/TRIGGER/REFERENCES privileges on public-schema relations.
      **Named reachability triage completed 2026-07-29** (appended to
      `docs/security/supabase-security-advisor-warning-triage-2026-07-29.md`).
      The residual set was reconstructed by enumerating the live catalog through
      the pooler and subtracting the 66 revoke statements already applied: 33
      functions remain client-executable, i.e. 33 authenticated + 6 anon = 39 of
      the 41 remaining function findings, each now named with a caller-based
      disposition. Six anon findings are required product surfaces (confirmed:
      `public-local-businesses` builds its client with the anon key). Eleven are
      live RLS policy dependencies, where revoking EXECUTE would break the policy
      rather than harden it. Twelve are intentional signed-in RPCs with named app
      callers. Three are closable — `admin_role`, `business_member_role`, and
      `get_runtime_billing_config` are reached only through SECURITY DEFINER
      callers, appear in no policy, and have only a service-role Edge caller;
      staged as `20260824144000` with a source test, expected to take 43 warnings
      to 40. One is deliberately left open: `validate_business_invite` has no
      caller anywhere, and "no caller found" is weaker evidence than "definer-only",
      so it needs a product decision instead of a revoke. The last two findings
      belong to functions created by migrations the test project has not received.
- [x] **GoTrue hardening** specification built (the `[DEV]` half):
      `docs/security/gotrue-hardening-specification-2026-07-29.md` gives an
      11-row proposed-value table with rationale, cost, and failure mode for OTP
      expiry, session timebox/inactivity, anonymous sign-in, manual linking,
      CAPTCHA, password requirements, SMTP sender, and rate limits.
      Leaked-password protection stays deferred (Pro-only). Two things it pins
      down: `supabase config push` must **not** be used (the repo's `[auth]`
      block is localhost-shaped and would break every redirect), and CAPTCHA is
      not a toggle — no `captchaToken` exists anywhere in the client, so
      enabling it server-side first would break sign-up, sign-in, and password
      reset. Each dashboard change remains a separate founder approval.
- [x] Reran the authenticated RLS, cross-tenant, and normal-business-rejection
      probes: `docs/security/database-probe-results-2026-07-29.md`. The "stale
      creds" blocker did not apply — `scripts/db-tests/*` mints its own throwaway
      users through the service role. All nine suites ran against the
      SSL-enforced test project, which also re-proves HTTPS clients are
      unaffected by SSL enforcement. Two stale suites were repaired to match
      intentional hardening (2e now 13/13, 2f now 9/9): they were failing on the
      `businesses` column-grant model (`20260820121000`) and on a fixture that
      predated the profile-edit capability gate (`20260817120000`), not on
      security defects. **One real defect confirmed — see the next item.**
- [x] **Cross-tenant read exposure on `business_locations`** (found 2026-07-29;
      migration **applied to production 2026-07-30**). Post-apply verification:
      migration parity is exact through `20260824144000`; anon reads of
      `business_locations` still return `[]`; the public `businesses` catalog
      still returns rows; `gate:rls` reports no anon data exposure; all seven
      probed Edge Functions are healthy.
      **One thing remains genuinely unverified, and it is the important one.**
      The migration is `DROP POLICY IF EXISTS`, so it either dropped the pilot
      policy or was a no-op — and there is still no way from here to tell which,
      because confirming it needs production SQL access (founder-held password)
      or a working authenticated production identity. The exposure was proved in
      the test project, and the fix is proved correct there by construction, but
      "production is now clean" is inference, not measurement. Close it during the
      next founder dashboard session by running, in the SQL editor:
      `select policyname from pg_policies where schemaname='public' and tablename='business_locations';`
      and confirming `Auth users can read business locations (pilot)` is absent.
      Original finding follows.
      an untracked pilot-era policy `"Auth users can read business locations
      (pilot)"` — `FOR SELECT TO public USING (auth.uid() IS NOT NULL)` — exists
      in the live catalog and in no migration in this repository. Permissive
      policies are OR'd, so it defeats the owner-scoped policy beside it: owner A
      reads owner B's row. Anonymous callers are unaffected. The exposed columns
      are merchant premises data, but the policy bypasses the public-status
      predicate, hidden-business, and suspension rules, so any signed-in account
      can enumerate the address and phone of pre-approval, hidden, or suspended
      merchants. A sweep found no second instance. Remediation is staged, not
      applied: `20260824143000_remove_pilot_business_location_read_policy.sql`
      (+ source test). Production presence is inferred, not verified — that needs
      the founder-held production database password or a throwaway authenticated
      production identity. **Applying it is a separate approval.**
- [ ] **Founder `unvmex2@hotmail.com` cannot obtain a production token**
      (found 2026-07-29): the password grant returns HTTP 500 `Database error
      querying schema` while other addresses return the normal 400, so
      production auth is working in general and this is account-scoped, not an
      outage. It matters because that mailbox is the chosen security-alert
      destination and one of the two active `admin_users` owner rows. Diagnosing
      it needs an admin read of that user's `auth` rows, which is founder-gated.
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
      **Deferred, not pending:** there is no hostname to point at — the purchase
      above was declined under the zero-cost policy. This item unblocks only when
      that cost decision is revisited. Its real cost is already recorded in the
      takeover worksheet: backend RTO for installed clients is gated on app
      store review, i.e. days rather than hours.

## Phase 9 — Dependencies + exercise

- [x] `[DEV]` Triage npm audit (measured 1 critical / 63 high / 9 moderate before the safe fix) without forcing an
      unsafe Expo major upgrade; separately review Deno/esm.sh imports in Edge Functions
      (npm audit does not see them).
- [ ] `[DAN+DEV]` Simulated takeover + recovery exercise. The `[DEV]` half is
      done: `docs/security/takeover-recovery-exercise-2026-07-29.md` is an
      executable worksheet — preconditions with a tabletop fallback, a scenario
      chosen because it is the only single compromise that reaches data
      destruction, the release pipeline, and the recovery channel at once, six
      phases with the commands that exist today, timing and RPO/RTO fields, and a
      corrective-action log. Executing it still needs the founder-provisioned
      backup object, vault, and disposable project.

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
- The twelve separately approved migrations applied successfully; linked
  migration parity now matches through `20260824142000`.
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
- The separately approved `20260824141000` migration removed direct client
  execution from six internal helpers. Its cleanup cron job remains active,
  four dependent triggers remain enabled, all six anon routes are denied, and
  four representative trusted read-only RPCs return HTTP 200. Advisor dropped
  to 44 warnings with 0 errors.
- The separately approved `20260824142000` migration removed direct client
  execution from `user_owns_business_location`. Its anon RPC route returns
  HTTP 401 while the service-role RPC returns HTTP 200. Advisor dropped to 43
  warnings with 0 errors.
- Before hosted SSL enforcement was tested, the independent backup, disposable
  restore, and release-catalog tools were changed to force libpq `PGSSLMODE=require`.
  Their focused source test passed, the release-gate workflow parsed, and both
  shell scripts passed syntax validation.
- Read-only dashboard inspection of the separate `twofer testing` project
  (`zsuzrerdailvylccqtds`) first confirmed SSL enforcement was off and its
  direct database access open to all IP addresses. After the separately
  approved test-only restart, the dashboard confirms SSL enforcement is on and
  the project is `ACTIVE_HEALTHY`. The linked production project was inspected
  separately and no production setting was modified. The unauthenticated test
  REST root responds with the expected HTTP 401 (no API key), confirming its
  public HTTPS endpoint is reachable after the restart.
- Control-plane snapshots now record: the Free plan supplies no scheduled
  database backups, no physical backup/PITR exists, SSL enforcement
  false, database CIDRs open to all IPv4/IPv6, the three approved Edge secret
  names present, public GitHub visibility with no protection/ruleset and live
  Dependabot security updates disabled, no DNSSEC delegation, and DMARC
  `p=none`.
## Local verification record — 2026-07-29 (second pass)

- `npm run test:db` — all nine remote suites against the SSL-enforced test
  project. 2a 12/0/2, 2b 15/0/0, 2c 8/1/1 (the confirmed `business_locations`
  defect), 2d 14/0/0, 2e **13/0/0** and 2f **9/0/0** after the stale-suite
  repairs, 2h 21/0/0, 2i 19/0/0, 2j 13/0/0.
- `scripts/assert-test-db.mjs` re-proved fail-closed with no environment and
  pass-only for the allowlisted test ref.
- `node scripts/security/verify-database-tls.mjs` against four endpoints —
  TLSv1.3/AES-256-GCM everywhere, cleartext refused everywhere.
- `supabase migration list --db-url` against the enforced test project — full
  195-row table returned; the same command across `sslmode=disable|prefer|
  require|verify-full` succeeded in all four cases, which is how the CLI's
  `sslmode` indifference was established.
- `scripts/security/pg-read.mjs` — authenticated via SCRAM over TLS and ran the
  `pg_policies`, `information_schema`, and `pg_proc` catalog reads behind the
  `business_locations` and Advisor findings. Measured caveat recorded in the
  file: Supavisor does not forward `default_transaction_read_only`, so the
  single-read-statement guard is the control that is actually enforced.
- New focused tests pass: the `20260824143000` migration gate (3 tests), the
  `20260824144000` migration gate (3 tests), and the extended
  `lib/independent-backup-source.test.ts` (6 tests) covering the verify-full
  upgrade and its fail-closed behavior.
- `bash -n` passed for both backup shell scripts; `independent-backup.yml`
  parsed.
- No production mutation of any kind was performed in this pass. Test-project
  access was read-only apart from the throwaway users the db-test suites create
  and delete themselves.

- `git diff --check` — passed (line-ending notices only).
- No website/DNS deploy, unrelated provider-console change, paid-plan
  activation, merge, or app release was performed. Production mutations were
  limited to the separately approved three-secret configuration, six
  migrations, and 28 Edge Function deployments.
