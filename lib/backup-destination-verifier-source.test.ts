import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const verifier = readFileSync(
  join(process.cwd(), "scripts", "security", "verify-backup-destination.mjs"),
  "utf8",
);

describe("backup destination verifier", () => {
  it("requires the retention capabilities the backup script depends on", () => {
    // put-object --object-lock-mode COMPLIANCE needs writeFileRetentions, and
    // the head-object verification in run-independent-backup.sh needs
    // readFileRetentions. A key without them uploads UNLOCKED backups.
    for (const capability of [
      "listBuckets",
      "listFiles",
      "readFiles",
      "writeFiles",
      "readFileRetentions",
      "writeFileRetentions",
    ]) {
      expect(verifier).toContain(`"${capability}"`);
    }
  });

  it("never reports an unreadable lock configuration as disabled", () => {
    // Regression guard. B2 returns {isClientAuthorizedToRead: false, value: null}
    // when the key lacks readBucketRetentions. Collapsing that null into
    // "disabled" produced a confident false negative during setup.
    expect(verifier).toMatch(/isClientAuthorizedToRead/);
    expect(verifier).toMatch(/This is NOT the same as disabled/);
    expect(verifier).toMatch(/cannot read bucket lock configuration/);
  });

  it("proves lock enforcement with a control rather than a bare refusal", () => {
    // A delete refusal alone is ambiguous: B2 answers access_denied for
    // permission problems too. The control deletes an UNLOCKED object with the
    // same key, so a refusal can only be attributed to the retention.
    expect(verifier).toMatch(/control-unlocked-/);
    expect(verifier).toMatch(/control delete failed, so lock enforcement is unproven/);
    expect(verifier).toMatch(/came from COMPLIANCE retention, not from permissions/);
  });

  it("keeps lifecycle windows longer than their object-lock retention", () => {
    // daily/ objects are locked 7 days, monthly/ 90. A lifecycle window shorter
    // than the lock cannot delete the file it targets.
    const daily = verifier.match(/fileNamePrefix: "daily\/", daysFromUploadingToHiding: (\d+)/);
    const monthly = verifier.match(/fileNamePrefix: "monthly\/", daysFromUploadingToHiding: (\d+)/);
    expect(daily).not.toBeNull();
    expect(monthly).not.toBeNull();
    expect(Number(daily![1])).toBeGreaterThan(7);
    expect(Number(monthly![1])).toBeGreaterThan(90);
  });

  it("reads credentials from env or a gitignored file and never prints them", () => {
    expect(verifier).toMatch(/B2_KEY_ID/);
    expect(verifier).toMatch(/B2_APPLICATION_KEY/);
    expect(verifier).toMatch(/security\/key\.txt/);
    // The key material must never reach stdout.
    expect(verifier).not.toMatch(/console\.log\([^)]*\bappKey\b/);
    expect(verifier).not.toMatch(/console\.log\([^)]*\bkeyId\b/);
  });
});
