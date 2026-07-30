# Simulated takeover and recovery exercise — worksheet

Developer half of the Phase 9 `[DAN+DEV]` item in
`docs/plans/founder-security-hardening-plan-2026-07-29.md`. The abstract
revocation order already lives in `founder-security-operations-runbook.md`
("Incident order"). This is the executable version: a scenario, the exact
commands that exist today, timing fields, and pass criteria — so the joint
session needs only founder-controlled providers, not fresh design work.

**Nothing here is a drill you can run solo.** Steps marked `[DAN]` need founder
credentials the developer must never hold. Fill the blanks during the run; the
completed sheet is the evidence artifact.

Exercise date: ____________  Operators: ____________  Total elapsed: ________

## Preconditions (do not start without all four)

| # | Precondition | Status | Blocking plan item |
|---|---|---|---|
| P1 | At least one verified immutable backup object exists in the separate B2 account | ☐ | Phase 1, founder creates the account |
| P2 | The secrets-values vault is populated and its checksum verifies offline | ☐ | Phase 1, `[DAN+DEV]` |
| P3 | A disposable Supabase project exists, distinct from production | ☐ | Phase 1, founder provisions |
| P4 | A known-clean device on a network that is not the compromised one | ☐ | — |

If P1–P3 are not met, the exercise cannot measure RTO. Run the **tabletop
variant** instead: walk each step aloud, record the time each *would* take, and
mark the sheet "TABLETOP" so it is never mistaken for a measured drill.

## Scenario

Assume the worst realistic case for this business, which is the one the plan is
built around:

> The founder's primary Google identity is compromised. The attacker has an
> active Supabase dashboard session, a valid GitHub token, and can read the
> founder's email. They have not yet deleted anything.

This scenario is chosen because it is the only single compromise that reaches
data destruction (Supabase project deletion), the release pipeline (GitHub +
EAS), and the recovery channel (email) at once.

## Phase A — Contain (target: 20 minutes)

Sessions first. Rotating a key while the attacker holds a live session just
hands them the new key.

| # | Action | Owner | Command / location | Start | Done |
|---|---|---|---|---|---|
| A1 | Sign out all sessions on the founder Google account; verify no unknown passkeys or recovery methods | `[DAN]` | Google account security page | | |
| A2 | Sign out all Supabase sessions; confirm org member list | `[DAN]` | Supabase dashboard | | |
| A3 | Revoke all GitHub sessions, then PATs and OAuth grants | `[DAN]` | GitHub settings | | |
| A4 | Revoke Vercel, Stripe, Cloudflare, registrar, Apple, Google Play, EAS sessions | `[DAN]` | each console | | |
| A5 | Confirm no mail forwarding rule, filter, or auto-reply was added | `[DAN]` | founder mailbox | | |

**Pass criterion:** every provider shows exactly one active session, on the clean
device, and the mailbox has no rules the founder did not create.

A5 is not optional bookkeeping. A forwarding rule survives every password reset
and silently keeps the attacker in the recovery loop.

## Phase B — Assess before rotating (target: 15 minutes)

| # | Action | Owner | Command | Result |
|---|---|---|---|---|
| B1 | Confirm the production project still exists and is healthy | `[DEV]` | `supabase projects list` | |
| B2 | Confirm no unexpected migration was applied | `[DEV]` | `supabase migration list --linked` | |
| B3 | Confirm deployed function versions match the reviewed SHA | `[DEV]` | `npm run gate:release-state` | |
| B4 | Confirm the database TLS posture is unchanged | `[DEV]` | `node scripts/security/verify-database-tls.mjs "prod=aws-0-us-west-2.pooler.supabase.com:5432\|postgres.kvodhiqhdqnptqovovia"` | |
| B5 | Check for new untracked policies, views, or functions | `[DEV]` | `scripts/security/pg-read.mjs` against `pg_policies` / `pg_proc` | |
| B6 | Read the admin audit log for denied and successful admin actions | `[DEV]` | `admin_audit_log` | |
| B7 | Check Stripe for payout-bank or webhook-endpoint changes | `[DAN]` | Stripe dashboard | |

B5 exists because this class of drift is not hypothetical: the 2026-07-29 pass
found two untracked reporting views and one untracked cross-tenant RLS policy
(`docs/security/database-probe-results-2026-07-29.md`). An attacker adding a
permissive policy is indistinguishable from that drift unless you diff against
the migration set.

B6 has a stated limit: a full service-key compromise can erase
`admin_audit_log`. Treat the external `ADMIN_ALERT_EMAIL` copies as the
authoritative record when the two disagree.

## Phase C — Rotate (target: 45 minutes)

| # | Action | Owner | Notes |
|---|---|---|---|
| C1 | Rotate the database password | `[DAN]` | Invalidates the backup runner's `BACKUP_SUPABASE_DB_URL` — update the secret in the same sitting or the next backup fails silently |
| C2 | Rotate Supabase API keys (anon + service role) | `[DAN]` | The anon key is embedded in installed app builds; plan for a client release |
| C3 | Rotate Stripe secret/restricted keys and the webhook signing secret | `[DAN]` | Webhook events are not editable in the Workbench UI — use a Write-scoped restricted key |
| C4 | Rotate OpenAI, Gemini, Resend, Google Places keys | `[DAN]` | Re-issue procedures live in `docs/security/secrets-inventory.md` |
| C5 | Rotate `CRON_SECRET`, `QR_SCAN_IP_HASH_SECRET`, wallet signing material | `[DAN]` | Rotating the QR hash secret breaks historical scan de-duplication — accept and note it |
| C6 | Redeploy Edge Functions from the reviewed SHA | `[DEV]` | Deployed == committed == pushed, checked before the deploy |
| C7 | Replace the GitHub token with a fine-grained one | `[DAN]` | |

**Record here the one thing this phase is really measuring:** which rotation
broke something, and how long the break lasted. ____________________

C2 is the step most likely to exceed its budget, because the anon key ships
inside installed builds. Write down the real number; a rotation that needs a
store review is an RTO of days, not minutes, and the plan should say so.

## Phase D — DNS and identity, last (target: 20 minutes)

Only after registrar and Cloudflare control is provably back.

| # | Action | Owner | Verify |
|---|---|---|---|
| D1 | Confirm every DNS record matches the exported zone | `[DEV]` | Compare against the config backup's `cloudflare-dns-records.json` |
| D2 | Confirm auto-renew and the backup payment method | `[DAN]` | |
| D3 | Confirm SPF/DKIM still pass and DMARC is unchanged | `[DEV]` | Send one test message, read the headers |
| D4 | Confirm the transfer lock is still on | `[DAN]` | |

## Phase E — Prove recovery, not just containment (target: measure it)

This is the phase that makes the exercise worth running. Containment can be
faked; a restore cannot.

| # | Action | Owner | Command | Elapsed |
|---|---|---|---|---|
| E1 | Retrieve the newest immutable backup and verify its checksum | `[DEV]` | `scripts/security/verify-independent-backup.sh <archive> <identity>` | |
| E2 | Restore into the disposable project | `[DEV]` | same script with the disposable URL and `ALLOW_DISPOSABLE_RESTORE=true` | |
| E3 | Prove Auth, Storage, and one Edge Function work in the restored project | `[DEV]` | `scripts/security/verify-disposable-project.mjs` | |
| E4 | Re-mint one secret from the vault and confirm the function works with it | `[DAN+DEV]` | | |
| E5 | Record the measured RPO (backup age) and RTO (E1→E4) | both | | |

**Pass criterion:** RPO ≤ 24h and a documented RTO. The plan's website RTO
target is 4h; the full app/backend RTO is defined as "whatever this drill
measures", so E5 is the number that closes that plan line.

Measured RPO: ________  Measured RTO: ________

## Phase F — Corrective actions

One row per thing that did not work. This is the only output that changes the
system.

| # | What failed or took too long | Root cause | Fix | Owner | Plan item |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

## Known gaps this exercise will expose

Recording them now so they are not mistaken for exercise failures:

- **No PITR.** RPO is bounded by the daily backup, by approved cost decision.
  Up to 24h of data loss is the accepted posture.
- **No custom hostname.** A replacement Supabase project forces a new store
  release, so backend RTO for installed clients is gated on app review. This is
  Phase 8, deferred on cost.
- **Anon key in installed builds.** C2 cannot fully complete without a client
  release.
- **Test project 19 migrations behind.** It cannot stand in for production during
  a restore verification until it is caught up.
- **`unvmex2@hotmail.com` cannot currently obtain a production token**
  (`database-probe-results-2026-07-29.md`, finding 4). Since it is the security
  alert destination, fix it before the exercise or Phase A's alerting is untested.
