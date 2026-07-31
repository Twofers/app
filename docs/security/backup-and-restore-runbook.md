# Independent backup and restore runbook

This repository now contains:

- `scripts/security/run-independent-backup.sh` — logical database dump,
  every live Storage bucket, configuration metadata, checksums, age encryption,
  and immutable upload.
- `scripts/security/verify-independent-backup.sh` — decryption, checksum and
  archive validation, plus an opt-in disposable-database restore.
- `.github/workflows/independent-backup.yml` — daily runner, intentionally not
  activated until the founder provisions the separate destination and secrets.

Supabase documents that project deletion also deletes provider-held backups,
and that PITR supplies finer recovery granularity. Independent copies therefore
remain required even if PITR is enabled:
https://supabase.com/docs/guides/platform/backups

## Current configuration — verified 2026-07-30

Re-check any time with:

```bash
node scripts/security/verify-backup-destination.mjs            # read-only
node scripts/security/verify-backup-destination.mjs --prove-lock  # writes a test object
```

| Setting | Value | Status |
| --- | --- | --- |
| `BACKUP_S3_BUCKET` | `Twofer` (private) | Object Lock **enabled**, no bucket default retention |
| `BACKUP_S3_ENDPOINT_URL` | `https://s3.eu-central-003.backblazeb2.com` | |
| `BACKUP_S3_REGION` | `eu-central-003` | |
| `BACKUP_S3_ACCESS_KEY_ID` / `..._SECRET_ACCESS_KEY` | bucket-scoped B2 key | all six required capabilities present |
| `BACKUP_AGE_RECIPIENT` | `age14h87sed9kx36vk2ufpyh6jr9uwflqvqnzr37f4u47pafncvfryxstt9qqz` | round-trip verified |
| Lifecycle | `daily/` 10d, `monthly/` 100d, `verification/` 2d (each +1 to delete) | each window outlasts its own lock retention |

**Immutability is proven, not assumed.** An object uploaded with COMPLIANCE
retention read back as `mode: "compliance"` and could not be deleted, while a
control object uploaded *without* retention deleted cleanly using the same key.
The control is the point: B2 answers `access_denied` for permission failures
too, so a bare refusal would prove nothing.

The age identity (private key) lives outside this repository at
`%USERPROFILE%\Documents\twofer-backup-age-identity.txt`, restricted to the
owning user. **It exists in one place only until a second copy is made offline.**
If it is lost, every backup encrypted to the recipient above is permanently
unreadable — there is no recovery path by design.

Still outstanding before the first run: the Supabase secrets
(`BACKUP_SUPABASE_DB_URL`, `BACKUP_SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_URL`, `SUPABASE_PROJECT_REF`) and the
`INDEPENDENT_BACKUP_ENABLED` repository variable.

Two loose ends from setup: an unused second bucket `twoferapp`, and the first B2
key, which lacked retention capabilities and should be revoked.

## Founder activation checklist

1. Bootstrap budget decision (approved 2026-07-29): do not enable PITR while
   there are no customers and a 24-hour recovery point is acceptable. Revisit
   only when losing one day of changes would materially harm customers or cost
   more than the add-on.
2. Create a separate Backblaze B2 account and private bucket with Object Lock
   enabled. B2 includes the first 10 GB and supports S3-compatible Compliance
   mode without an Object Lock surcharge:
   https://www.backblaze.com/cloud-storage/pricing
   https://www.backblaze.com/docs/cloud-storage-object-lock
3. Create a backup-only B2 application key scoped only to the backup bucket.
   It needs exactly six capabilities:

       listBuckets  listFiles  readFiles  writeFiles
       readFileRetentions  writeFileRetentions

   **The two retention capabilities are required, not forbidden.** An earlier
   version of this checklist said the key should have no retention-management
   capability; that is wrong and it produces a key that silently uploads
   *unlocked* backups. `run-independent-backup.sh` calls
   `put-object --object-lock-mode COMPLIANCE`, which needs
   `writeFileRetentions`, and its `head-object` verification needs
   `readFileRetentions`. Without them the upload is unprotected and the job
   exits 4.

   Ordering trap: B2 only grants retention capabilities for a bucket that
   *already* has Object Lock enabled. Enable Object Lock on the bucket first,
   then mint the key — a key created beforehand cannot be upgraded, because B2
   keys are immutable.

   `deleteFiles` is not needed; lifecycle rules delete server-side.
4. Generate an age identity offline. Put only the public recipient in CI; keep
   the private identity in the founder vault and a second offline recovery
   location. Verify the pair round-trips (encrypt to the recipient, decrypt
   with the identity) before any backup depends on it.
5. Configure the workflow secrets named in
   `.github/workflows/independent-backup.yml`. Use credentials dedicated to
   backup. The backup and restore tools force libpq `PGSSLMODE=require`, so a
   direct database connection cannot silently fall back to plaintext. A
   management token is optional and
   should be read-scoped where supported. Configure the success heartbeat and
   failure webhook in a monitor controlled outside GitHub/Supabase; alert when
   no successful heartbeat arrives within 26 hours. Leave the repository
   variable `INDEPENDENT_BACKUP_ENABLED` unset until every credential,
   destination, retention policy, and monitor is approved.
   For B2, set `BACKUP_S3_ENDPOINT_URL` to the bucket region's S3 endpoint and
   map the B2 key ID/application key into the generic S3 access-key secrets.
   Configure lifecycle rules to hide and then delete `daily/` objects after
   their 7-day lock and `monthly/` objects after their 90-day lock; an expired
   lock does not delete an object by itself.
6. Confirm the estimated steady-state total remains below the free 10 GB
   allowance. The workflow rejects any single encrypted archive larger than
   900,000,000 bytes. Before every upload it lists the dedicated bucket and
   rejects any operation projected to exceed 9,500,000,000 bytes, preserving
   headroom below the free allowance even if lifecycle cleanup is delayed. The
   repository mirror uses the same aggregate ceiling.
7. Set `INDEPENDENT_BACKUP_ENABLED=true`, manually run the workflow, and confirm
   both the encrypted archive and checksum
   object have explicit Compliance retention. The job now fails if `head-object`
   cannot prove non-empty objects with Compliance retention.
8. Run `verify-independent-backup.sh` on the downloaded object.

## Secrets values recovery vault

Prepare one file per credential/configuration group plus
`recovery-instructions.md` in a temporary directory outside the repository.
The instructions must name the provider owner, consumer, revocation path,
re-issue path, and last tested date. Never put secret values in filenames or
shell arguments.

Run:

`bash scripts/security/create-secrets-recovery-vault.sh <outside-input-dir> <age-recipient> <outside-output.tar.age>`

The creator refuses input/output inside the Git worktree, refuses symlinks and
overwrites, adds internal checksums, and encrypts before producing the output.
Copy the encrypted vault and checksum to two founder-controlled offline
locations. Verify a copy with:

`bash scripts/security/verify-secrets-recovery-vault.sh <vault.tar.age> <age-identity>`

Populating and verifying real values remains a founder operation; the
developer must never request or handle those credentials.

Bootstrap retention implemented by the workflow: 7 days for daily objects and
90 days for the monthly object created on the first UTC day of each month.
Both values remain configurable. Review the bucket's measured storage after
the first run and monthly; if it approaches 10 GB, the job must remain disabled
until retention, backup contents, or an explicitly approved budget is changed.

## What is covered

- Custom-format `pg_dump`, including Auth schema data available to the database
  backup role.
- All buckets returned by the live Storage API. The 2026-07-29 snapshot contains
  `deal-ads`, `business-assets`, `deal-photos`, `ai-deal-assets`, and
  `business-logos`.
- Auth configuration, function inventory, secret metadata/names, explicit
  pg_cron job and extension snapshots, DNS export when optional read tokens are
  supplied, repository SHA, and security inventories. An optional Stripe
  read-only restricted key exports webhook endpoint configuration into the
  encrypted payload.
- An independently encrypted all-refs Git bundle when the workstation mirror
  script is run.

## Quarterly restore drill

1. Create an explicitly disposable Supabase project and record its project ref.
2. Download one daily and the latest monthly backup with the restore-only IAM
   identity; verify the sidecar checksum.
3. Run structural verification without a database URL first.
4. Set `ALLOW_DISPOSABLE_RESTORE=true`, `DISPOSABLE_SUPABASE_PROJECT_REF`, and
   `PRODUCTION_SUPABASE_PROJECT_REF`, then pass only the disposable database
   URL. Never pass production; the verifier requires the URL host/username to
   prove the disposable ref, refuses the configured primary URL, and uses
   `pg_restore --clean`.
5. Recreate buckets from `storage-manifest.json`, upload a sample from every
   bucket, and compare sizes/hashes. The repository verifier automates this
   step and the Auth/Function checks:
   `node scripts/security/verify-disposable-project.mjs <extracted-storage-directory>`.
   It requires `ALLOW_DISPOSABLE_RESTORE=true`, matching disposable URL/ref
   variables, a different explicit production ref, throwaway restored-user
   credentials, and the name of the test Edge Function. It refuses the primary
   configured Supabase URL.
6. Re-mint one provider secret from the offline runbook, deploy one Edge
   Function from the recorded SHA, and verify one Auth login. Set
   `RESTORE_TEST_FUNCTION_ALLOWED_STATUSES` only to the exact healthy status
   expected from the chosen test request; do not accept arbitrary 4xx/5xx
   responses as proof.
7. Record measured database RPO, website RTO, backend RTO, missing
   configuration, and corrective work. Target independent-backup RPO is 24
   hours or less and website RTO is four hours.

## Signing credentials

The founder must run `eas credentials` interactively for Android and iOS and
download the managed credentials, following Expo’s official workflow:
https://docs.expo.dev/app-signing/syncing-credentials/

Encrypt the resulting credential JSON, Android keystore, iOS distribution
certificate/private key, provisioning profiles, passwords, and recovery steps
into the offline vault. Never commit them or upload them as ordinary CI
artifacts.
