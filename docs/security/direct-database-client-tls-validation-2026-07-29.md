# Direct database client TLS validation — 2026-07-29

Closes the Phase 4 gate "Validate every direct test-database client, then
separately approve production SSL enforcement" in
`docs/plans/founder-security-hardening-plan-2026-07-29.md`.

Nothing in this document changed a production setting. Production SSL
enforcement remains **off** and remains a separate founder approval.

## Method

Two tools were added, both read-only and dependency-free:

- `scripts/security/verify-database-tls.mjs` — speaks the Postgres v3 wire
  protocol with Node's `net`/`tls`. Sends `SSLRequest`, completes the TLS
  handshake, records protocol/cipher/certificate, then opens a second
  connection and sends a **cleartext** `StartupMessage` (exactly what
  `sslmode=disable` puts on the wire) to see whether the server answers with an
  `ErrorResponse`, closes, or offers authentication in the clear. No password is
  ever sent; the probe stops at the server's first reply.
- `scripts/security/pg-read.mjs` — minimal read-only client (TLS + SCRAM-SHA-256
  + simple query) used for live catalog verification. It refuses anything that is
  not a single `SELECT`/`WITH`/`TABLE`/`SHOW`/`EXPLAIN`.

## Inventory of direct database clients

| Client | Where | Reaches the DB how | TLS posture |
| --- | --- | --- | --- |
| `pg_dump` | `scripts/security/run-independent-backup.sh` | `SUPABASE_DB_URL` | libpq, `PGSSLMODE` exported by the script |
| `psql` (cron/extension capture) | same script | `SUPABASE_DB_URL` | same export |
| `psql` (RLS catalog gate) | `.github/workflows/release-gate.yml` | `SUPABASE_DB_URL` | `PGSSLMODE: require` job env |
| `pg_restore` | `scripts/security/verify-independent-backup.sh` | disposable project URL | same export |
| Supabase CLI (`migration list`, `db push`, `db lint`) | founder machine | linked project / `--db-url` | CLI-internal, see finding 4 |
| `scripts/security/pg-read.mjs` | founder machine | `PG_READ_URL` | TLS mandatory, aborts if refused |

Everything else in the repository — the mobile app, the website, all 78 public
Edge Functions, every `scripts/db-tests/*` suite, and every `probe-*.mjs` — talks
HTTPS to PostgREST/GoTrue/Storage and is **unaffected** by database SSL
enforcement. That was reconfirmed by running the remote database suites against
the SSL-enabled test project (see
`database-probe-results-2026-07-29.md`): 113 checks passed over HTTPS after
enforcement was switched on.

## Findings

### 1. The direct `db.<ref>.supabase.co` endpoints are IPv6-only and unreachable from the founder machine

`db.zsuzrerdailvylccqtds.supabase.co` and `db.kvodhiqhdqnptqovovia.supabase.co`
both publish AAAA records only (`2600:1f14:…`). No A record exists.
`getaddrinfo` on the founder machine returns `ENOTFOUND`/`ENOENT` for both, and
connecting to the literal IPv6 address returns `ENETUNREACH` — this machine has
no IPv6 route.

Consequence: **every direct database client in the table above reaches the
database through the IPv4 Supavisor pooler, not the direct endpoint.** The
correct pooler endpoints were determined empirically:

- test `zsuzrerdailvylccqtds` → `aws-1-us-west-2.pooler.supabase.com:5432`
- production `kvodhiqhdqnptqovovia` → `aws-0-us-west-2.pooler.supabase.com:5432`
  (recorded in `supabase/.temp/pooler-url`; both projects are `us-west-2`)

`aws-0-us-west-1` and `aws-1-us-west-1` answer TLS but reject the tenant with
`FATAL: (ENOTFOUND) tenant/user … not found`, so a wrong-region pooler host fails
loudly rather than silently.

Operational note for Phase 1: `BACKUP_SUPABASE_DB_URL` must therefore be a
**pooler** connection string. A GitHub-hosted runner pointed at the IPv6-only
direct host would fail to resolve it, and the failure would look like a network
flake rather than a configuration error.

### 2. Cleartext Postgres is already impossible on every reachable endpoint

`verify-database-tls.mjs` results (2026-07-30T01:59Z):

| Endpoint | Port | Wire user | SSLRequest | TLS | Cleartext startup |
| --- | --- | --- | --- | --- | --- |
| test pooler | 5432 | `postgres.zsuzrerdailvylccqtds` | `S` | TLSv1.3 / TLS_AES_256_GCM_SHA384 | closed without reply |
| test pooler | 6543 | `postgres.zsuzrerdailvylccqtds` | `S` | TLSv1.3 / same | closed without reply |
| production pooler | 5432 | `postgres.kvodhiqhdqnptqovovia` | `S` | TLSv1.3 / same | closed without reply |
| pooler, no tenant | 5432 | — | `S` | TLSv1.3 / same | closed without reply |

**Attribution caveat, stated deliberately.** Every one of these refusals is the
pooler's own behavior, not proof of a per-project setting: production has SSL
enforcement **off** and still refuses cleartext. Only a *direct* `db.<ref>`
endpoint answering a cleartext startup with an `ErrorResponse` would attribute
the refusal to the project setting, and those endpoints are unreachable from
here (finding 1). The tool reports `cleartextUsable` rather than
`sslEnforced` for exactly this reason.

What this does establish, and it is the question the approval actually turns on:
**no client currently reaching either database over the pooler can be using
cleartext, so enabling production SSL enforcement cannot break any of them.**

### 3. A real credentialed client works against the SSL-enforced test project

`supabase migration list --db-url …@aws-1-us-west-2.pooler.supabase.com:5432/postgres`
completed successfully against `zsuzrerdailvylccqtds` **after** SSL enforcement
was enabled there, returning the full 195-line migration table. This is a full
authenticated round trip (TLS + SCRAM + queries), not just a handshake.
`scripts/security/pg-read.mjs` likewise authenticated and ran catalog queries
against the same enforced project.

### 4. The Supabase CLI ignores `sslmode` entirely — including `verify-full`

The same command was run four times against the enforced test project, varying
only the connection-string parameter:

| `sslmode=` | Result |
| --- | --- |
| `disable` | **succeeded** |
| `prefer` | succeeded |
| `require` | succeeded |
| `verify-full` | **succeeded**, against a certificate the system trust store rejects |

`sslmode=disable` succeeding proves the CLI always negotiates TLS regardless of
the request — good for enforcement compatibility. `verify-full` succeeding
proves the CLI never validates the chain — it cannot be asked to. So the CLI's
transport is encrypted but **not authenticated**, and asking for `verify-full`
gives false assurance. Treat CLI connections as encrypted-only.

### 5. Supabase's database certificate is not in any default trust store

The pooler presents `CN=*.pooler.supabase.com`, issued by `Supabase Intermediate
2021 CA`, valid to 2030-03-11. Node's verification result is
`authorized=false, authorizationError=SELF_SIGNED_CERT_IN_CHAIN`.

This means `PGSSLMODE=require` — used by the backup, restore, and release-gate
tooling — encrypts but does not authenticate the server. An attacker able to
intercept the connection could present their own certificate and libpq would
accept it, which matters because the credential crossing that connection is the
production database superuser password.

**Remediation staged in this pass (zero cost, no production change):**
`run-independent-backup.sh` and `verify-independent-backup.sh` now upgrade to
`PGSSLMODE=verify-full` with `PGSSLROOTCERT` whenever `BACKUP_DB_ROOT_CERT`
points at a readable CA file, and **fail closed** if that variable is set but
unusable. `independent-backup.yml` materializes it from a new
`BACKUP_DB_ROOT_CERT_PEM` secret. Without the secret the tooling keeps today's
`require` behavior and emits a warning, so nothing breaks.

Founder step (Phase 2, `[DAN]`, $0): Supabase dashboard → Settings → Database →
SSL configuration → download the certificate, then store its contents as the
`BACKUP_DB_ROOT_CERT_PEM` repository secret. The certificate is public
information; it is not a credential. It is not fetched by tooling here because
pulling a trust root over the network is exactly the step that should be done by
hand from an authenticated dashboard.

## What the founder still has to approve

1. **Production SSL enforcement.** Evidence supports it: no reachable client
   uses cleartext, and the CLI plus a raw libpq-style client both work against
   the enforced test project. Residual risk is limited to a client that reaches
   the IPv6-only direct endpoint from somewhere with IPv6 egress, which no
   tooling in this repository does.
2. **`BACKUP_DB_ROOT_CERT_PEM`**, to move direct connections from encrypted to
   authenticated (finding 5).
3. **Catching the test project up on migrations** before it is relied on again as
   a pre-production mirror — it is 19 migrations behind
   (`database-probe-results-2026-07-29.md`, finding 1).
