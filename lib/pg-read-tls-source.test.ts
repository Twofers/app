import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("direct database tooling TLS posture", () => {
  it("pg-read verifies the server certificate by default", () => {
    // CodeQL js/disabling-certificate-validation, high severity. This client
    // sends a database password, so an unauthenticated channel would let a
    // machine-in-the-middle capture it. Verification must be the default and
    // skipping it must be an explicit, announced choice.
    const client = read("scripts/security/pg-read.mjs");
    expect(client).toMatch(/PG_READ_ROOT_CERT/);
    expect(client).toMatch(/PG_READ_INSECURE_TLS/);
    expect(client).toMatch(/Refusing to send a database password over an unverified TLS connection/);
    expect(client).toMatch(/rejectUnauthorized: true/);
    // The insecure path must announce itself rather than degrade silently.
    expect(client).toMatch(/WARNING: PG_READ_INSECURE_TLS=true/);
  });

  it("the TLS posture probe may skip verification, because it sends no credentials", () => {
    // Same CodeQL rule, but justified: this tool exists to report whether the
    // certificate validates, which requires completing a handshake that strict
    // verification would abort. It must never grow a password.
    const probe = read("scripts/security/verify-database-tls.mjs");
    expect(probe).toMatch(/certificateAuthorized/);
    expect(probe).toMatch(/certificateAuthorizationError/);
    expect(probe).toMatch(/codeql\[js\/disabling-certificate-validation\]/);
    // No password may ever be put on the wire by the probe. Check for real
    // usage (a property or assignment), not the word appearing in prose.
    const code = probe
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/\bpassword\b\s*[:=]/i);
  });

  it("the backup destination verifier sends key material only to a hard-coded host", () => {
    // CodeQL js/file-access-to-http, medium. Acceptable only because the
    // destination is a constant and cannot be influenced by the file contents.
    const verifier = read("scripts/security/verify-backup-destination.mjs");
    expect(verifier).toMatch(/const API = "https:\/\/api\.backblazeb2\.com\/b2api\/v3"/);
    expect(verifier).toMatch(/codeql\[js\/file-access-to-http\]/);
  });
});
