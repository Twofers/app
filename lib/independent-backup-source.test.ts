import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("independent backup and restore controls", () => {
  it("encrypts database, Storage, and configuration before immutable upload", () => {
    const backup = read("scripts/security/run-independent-backup.sh");
    expect(backup).toMatch(/pg_dump "\$SUPABASE_DB_URL"/);
    expect(backup).toMatch(/export PGSSLMODE=require/);
    expect(backup).toMatch(/cron-jobs\.jsonl/);
    expect(backup).toMatch(/database-extensions\.csv/);
    expect(backup).toMatch(/export-storage\.mjs/);
    expect(backup).toMatch(/age --recipient "\$BACKUP_AGE_RECIPIENT"/);
    expect(backup).toMatch(/sha256sum "\$encrypted"/);
    expect(backup).toMatch(/--object-lock-mode COMPLIANCE/);
    expect(backup).toMatch(/aws s3api head-object/);
    expect(backup).toMatch(/mode" != "COMPLIANCE"/);
    expect(backup).toMatch(/BACKUP_S3_ENDPOINT_URL/);
    expect(backup).toMatch(/BACKUP_DAILY_RETENTION_DAYS:-7/);
    expect(backup).toMatch(/BACKUP_MONTHLY_RETENTION_DAYS:-90/);
    expect(backup).toMatch(/BACKUP_MAX_ARCHIVE_BYTES:-900000000/);
    expect(backup).toMatch(/BACKUP_MAX_STORED_BYTES:-9500000000/);
    expect(backup).toMatch(/aws s3 ls "s3:\/\/\$BACKUP_S3_BUCKET"/);
    expect(backup).toMatch(/Projected backup-bucket storage/);
    expect(backup).toMatch(/daily_retain_until/);
    expect(backup).toMatch(/monthly_retain_until/);
    expect(backup).toMatch(/BACKUP_SUCCESS_HEARTBEAT_URL/);

    const checksumUpload = backup.indexOf('--key "$daily_key.sha256"');
    const checksumVerification = backup.indexOf(
      'verify_locked_object "$daily_key.sha256"',
    );
    expect(checksumUpload).toBeGreaterThan(-1);
    expect(checksumVerification).toBeGreaterThan(checksumUpload);
  });

  it("keeps backup credentials out of dependency installation", () => {
    const workflow = read(".github/workflows/independent-backup.yml");
    const install = workflow.indexOf("npm ci --ignore-scripts");
    const secretEnvironment = workflow.indexOf("SUPABASE_DB_URL:");
    expect(install).toBeGreaterThan(-1);
    expect(secretEnvironment).toBeGreaterThan(install);
    expect(workflow).toMatch(/persist-credentials: false/);
    expect(workflow).toMatch(/if: vars\.INDEPENDENT_BACKUP_ENABLED == 'true'/);
    expect(workflow).toMatch(/BACKUP_FAILURE_WEBHOOK_URL/);
    expect(workflow).toMatch(/BACKUP_S3_ENDPOINT_URL/);
    expect(workflow).toMatch(/BACKUP_S3_ACCESS_KEY_ID/);
    expect(workflow).toMatch(/BACKUP_MAX_ARCHIVE_BYTES: "900000000"/);
    expect(workflow).toMatch(/BACKUP_MAX_STORED_BYTES: "9500000000"/);
  });

  it("requires an explicitly different disposable project for destructive restore", () => {
    const databaseVerifier = read("scripts/security/verify-independent-backup.sh");
    const projectVerifier = read("scripts/security/verify-disposable-project.mjs");
    expect(databaseVerifier).toMatch(/ALLOW_DISPOSABLE_RESTORE/);
    expect(databaseVerifier).toMatch(/DISPOSABLE_SUPABASE_PROJECT_REF/);
    expect(databaseVerifier).toMatch(/identity\.includes\(disposableRef\)/);
    expect(databaseVerifier).toMatch(/--clean/);
    expect(databaseVerifier).toMatch(/export PGSSLMODE=require/);
    expect(projectVerifier).toMatch(/disposableRef === productionRef/);
    expect(projectVerifier).toMatch(/RESTORE_SUPABASE_URL does not match/);
    expect(projectVerifier).toMatch(/refuses to target the configured primary Supabase URL/);
    expect(projectVerifier).toMatch(/Restored Auth login did not produce a session/);
    expect(projectVerifier).toMatch(/Restored Storage sample mismatch/);
    expect(projectVerifier).toMatch(/RESTORE_TEST_FUNCTION_ALLOWED_STATUSES/);
  });

  it("requires TLS for the catalog gate's direct database connection", () => {
    const workflow = read(".github/workflows/release-gate.yml");
    expect(workflow).toMatch(/PGSSLMODE: require/);
  });

  it("creates the secret-values vault only outside Git and verifies checksums", () => {
    const creator = read("scripts/security/create-secrets-recovery-vault.sh");
    const verifier = read("scripts/security/verify-secrets-recovery-vault.sh");
    expect(creator).toMatch(/Secret-vault input must be outside the Git worktree/);
    expect(creator).toMatch(/Encrypted vault output must be outside the Git worktree/);
    expect(creator).toMatch(/must not contain symbolic links/);
    expect(creator).toMatch(/only regular files and directories/);
    expect(creator).toMatch(/Refusing to overwrite/);
    expect(creator).toMatch(/age --recipient/);
    expect(verifier).toMatch(/unsafe extraction path/);
    expect(verifier).toMatch(/sha256sum --check SHA256SUMS/);
  });
});
