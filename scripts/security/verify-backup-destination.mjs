// Backblaze B2 backup-destination verifier — Phase 1 of the founder security plan.
//
// PURPOSE
//   The independent backup is only worth having if its destination is genuinely
//   immutable. A bucket flag that says "Object Lock: Enabled" is not proof —
//   the key also has to be allowed to set retention, and the retention has to
//   actually stop a delete. This checks all of that, and can prove it by doing
//   it rather than by reading settings.
//
//   Learned the hard way: B2 returns
//   `fileLockConfiguration: {isClientAuthorizedToRead: false, value: null}`
//   when the key lacks `readBucketRetentions`. Treating that null as "disabled"
//   produces a confident false negative, so this tool reports the authorization
//   flag explicitly and never collapses "cannot read" into "off".
//
// USAGE
//   node scripts/security/verify-backup-destination.mjs               # read-only
//   node scripts/security/verify-backup-destination.mjs --prove-lock  # writes a test object
//   node scripts/security/verify-backup-destination.mjs --set-lifecycle
//
//   Credentials come from B2_KEY_ID / B2_APPLICATION_KEY, or from a key file
//   (default: security/key.txt, which is gitignored). Values are never printed.
//
// --prove-lock writes one small object under `verification/` with COMPLIANCE
// retention, re-reads it, then tries to delete it and expects to be refused.
// That object is genuinely undeletable until its retention expires — that is
// the property being demonstrated. Retention defaults to 1 day.

import fs from "node:fs";
import crypto from "node:crypto";

const API = "https://api.backblazeb2.com/b2api/v3";

// The six the backup script actually needs. put-object --object-lock-mode
// needs writeFileRetentions; the head-object verification needs
// readFileRetentions. Without those two the upload lands unlocked and
// run-independent-backup.sh exits 4.
const REQUIRED_CAPABILITIES = [
  "listBuckets",
  "listFiles",
  "readFiles",
  "writeFiles",
  "readFileRetentions",
  "writeFileRetentions",
];

// Present in the console's "Read and Write" preset but not needed. Not fatal:
// COMPLIANCE retention cannot be bypassed by anyone, so deleteFiles cannot
// remove a locked backup. Reported so the gap stays visible.
const UNNEEDED_CAPABILITIES = [
  "deleteFiles",
  "writeBuckets",
  "bypassGovernance",
  "writeBucketLifecycleRules",
  "writeKeys",
];

function readCredentials(keyFile) {
  if (process.env.B2_KEY_ID && process.env.B2_APPLICATION_KEY) {
    return { keyId: process.env.B2_KEY_ID, appKey: process.env.B2_APPLICATION_KEY };
  }
  if (!fs.existsSync(keyFile)) {
    throw new Error(
      `Set B2_KEY_ID and B2_APPLICATION_KEY, or provide ${keyFile}. ` +
        "Preferred file format:\n  keyId=003...\n  applicationKey=K003...",
    );
  }
  const raw = fs.readFileSync(keyFile, "utf8");
  const labelled = Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(keyId|applicationKey)\s*=\s*(\S+)\s*$/i))
      .filter(Boolean)
      .map((m) => [m[1].toLowerCase(), m[2]]),
  );
  if (labelled.keyid && labelled.applicationkey) {
    return { keyId: labelled.keyid, appKey: labelled.applicationkey };
  }
  // Fall back to shape matching for unlabelled files: an application key is
  // K00<n> + ~28 chars; a key id is 25 hex-ish chars.
  const tokens = raw.split(/[\s=]+/).map((t) => t.trim()).filter(Boolean);
  const appKey = tokens.find((t) => /^K00\d/.test(t) && t.length >= 30);
  const keyId = tokens.find((t) => /^[0-9a-f]{25}$/i.test(t));
  if (!appKey || !keyId) {
    throw new Error(
      "Could not find both halves of the key. Use labelled lines:\n  keyId=003...\n  applicationKey=K003...",
    );
  }
  return { keyId, appKey };
}

async function b2(url, token, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: token, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function authorize({ keyId, appKey }) {
  // CodeQL flags "file data flows to an outbound request" here. That is exactly
  // and only what this does: the credentials read from the key file are sent to
  // Backblaze — their own issuer — to authenticate. `API` is a hard-coded
  // https://api.backblazeb2.com constant, not derived from the file, so the
  // file's contents cannot redirect where they are sent.
  // codeql[js/file-access-to-http]
  const basic = Buffer.from(`${keyId}:${appKey}`).toString("base64");
  const res = await fetch(`${API}/b2_authorize_account`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error(`b2_authorize_account failed: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const args = process.argv.slice(2);
  const proveLock = args.includes("--prove-lock");
  const setLifecycle = args.includes("--set-lifecycle");
  const keyFileArg = args.indexOf("--key-file");
  const keyFile = keyFileArg !== -1 ? args[keyFileArg + 1] : "security/key.txt";
  const retainDays = Number(process.env.B2_PROOF_RETAIN_DAYS ?? 1);

  const account = await authorize(readCredentials(keyFile));
  const api = account.apiInfo.storageApi;
  const failures = [];

  console.log(`bucket:   ${api.bucketName ?? "(account-wide — should be scoped to one bucket)"}`);
  console.log(`endpoint: ${api.s3ApiUrl}`);
  if (!api.bucketName) failures.push("key is not restricted to a single bucket");

  console.log("\ncapabilities required by the backup script:");
  for (const capability of REQUIRED_CAPABILITIES) {
    const present = api.capabilities.includes(capability);
    if (!present) failures.push(`missing capability: ${capability}`);
    console.log(`  ${present ? "OK  " : "MISS"}  ${capability}`);
  }
  const extra = UNNEEDED_CAPABILITIES.filter((c) => api.capabilities.includes(c));
  console.log(`\nover-permissioned (not fatal): ${extra.length ? extra.join(", ") : "none"}`);

  // --- bucket configuration -------------------------------------------------
  const list = await b2(`${api.apiUrl}/b2api/v3/b2_list_buckets`, account.authorizationToken, {
    accountId: account.accountId,
    ...(api.bucketId ? { bucketId: api.bucketId } : {}),
  });
  if (!list.ok) throw new Error(`b2_list_buckets failed: HTTP ${list.status} ${list.text}`);
  const bucket = list.json.buckets[0];

  const lock = bucket.fileLockConfiguration;
  console.log("\nobject lock:");
  if (!lock?.isClientAuthorizedToRead) {
    console.log("  UNKNOWN — this key cannot read the lock configuration.");
    console.log("  This is NOT the same as disabled. Add readBucketRetentions to check it.");
    failures.push("cannot read bucket lock configuration");
  } else {
    const enabled = lock.value?.isFileLockEnabled === true;
    console.log(`  ${enabled ? "ENABLED" : "*** DISABLED ***"}`);
    console.log(`  default retention: ${JSON.stringify(lock.value?.defaultRetention ?? null)}`);
    if (!enabled) failures.push("object lock is disabled on the bucket");
  }

  const rules = bucket.lifecycleRules ?? [];
  console.log(`\nlifecycle rules: ${rules.length ? JSON.stringify(rules) : "none (keep all versions)"}`);
  if (rules.length === 0) {
    console.log("  Without rules, storage grows until BACKUP_MAX_STORED_BYTES refuses uploads.");
  }

  // --- optional: apply lifecycle rules -------------------------------------
  if (setLifecycle) {
    // Each window must outlast its own object-lock retention (7 days for
    // daily/, 90 for monthly/), or lifecycle cannot remove a still-locked file.
    const desired = [
      { fileNamePrefix: "daily/", daysFromUploadingToHiding: 10, daysFromHidingToDeleting: 1 },
      { fileNamePrefix: "monthly/", daysFromUploadingToHiding: 100, daysFromHidingToDeleting: 1 },
      { fileNamePrefix: "verification/", daysFromUploadingToHiding: 2, daysFromHidingToDeleting: 1 },
    ];
    const update = await b2(`${api.apiUrl}/b2api/v3/b2_update_bucket`, account.authorizationToken, {
      accountId: account.accountId,
      bucketId: bucket.bucketId,
      lifecycleRules: desired,
    });
    if (!update.ok) {
      console.log(`\nlifecycle update FAILED: HTTP ${update.status} ${update.text}`);
      failures.push("could not set lifecycle rules");
    } else {
      console.log(`\nlifecycle rules applied: ${JSON.stringify(update.json.lifecycleRules)}`);
    }
  }

  // --- optional: prove the lock actually holds ------------------------------
  if (proveLock) {
    console.log("\n--- object lock enforcement proof ---");
    const body = Buffer.from(
      `twofer backup destination verification\ncreated by scripts/security/verify-backup-destination.mjs\n`,
      "utf8",
    );
    const sha1 = crypto.createHash("sha1").update(body).digest("hex");
    const name = `verification/object-lock-proof-${sha1.slice(0, 12)}.txt`;
    const retainUntil = Date.now() + retainDays * 86400000;

    const uploadUrl = await b2(`${api.apiUrl}/b2api/v3/b2_get_upload_url`, account.authorizationToken, {
      bucketId: bucket.bucketId,
    });
    if (!uploadUrl.ok) throw new Error(`b2_get_upload_url failed: ${uploadUrl.text}`);

    const put = await fetch(uploadUrl.json.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: uploadUrl.json.authorizationToken,
        "X-Bz-File-Name": encodeURIComponent(name),
        "Content-Type": "text/plain",
        "Content-Length": String(body.length),
        "X-Bz-Content-Sha1": sha1,
        "X-Bz-File-Retention-Mode": "compliance",
        "X-Bz-File-Retention-Retain-Until-Timestamp": String(retainUntil),
      },
      body,
    });
    const putText = await put.text();
    if (!put.ok) {
      console.log(`  upload with COMPLIANCE retention FAILED: HTTP ${put.status} ${putText.slice(0, 300)}`);
      failures.push("could not upload a locked object");
    } else {
      const uploaded = JSON.parse(putText);
      console.log(`  uploaded ${name}`);

      const info = await b2(`${api.apiUrl}/b2api/v3/b2_get_file_info`, account.authorizationToken, {
        fileId: uploaded.fileId,
      });
      const retention = info.json?.fileRetention;
      console.log(`  retention read back: ${JSON.stringify(retention)}`);
      const mode = retention?.value?.mode;
      if (mode !== "compliance") {
        failures.push(`uploaded object is not under COMPLIANCE retention (mode=${mode})`);
      }

      const del = await b2(`${api.apiUrl}/b2api/v3/b2_delete_file_version`, account.authorizationToken, {
        fileName: uploaded.fileName,
        fileId: uploaded.fileId,
      });
      if (del.ok) {
        console.log("  DELETE SUCCEEDED — the object was NOT protected.");
        failures.push("a locked object could be deleted");
      } else {
        console.log(`  delete refused: HTTP ${del.status} ${del.json?.code ?? ""} ${del.json?.message ?? del.text.slice(0, 160)}`);
      }

      // CONTROL. A refusal on its own is ambiguous — B2 answers "access_denied"
      // for a permission problem too. Upload an identical object WITHOUT
      // retention and delete it with the same key: if that succeeds, the
      // refusal above can only have come from the COMPLIANCE lock.
      const controlBody = Buffer.from("control: unlocked object, expected to delete cleanly\n", "utf8");
      const controlSha1 = crypto.createHash("sha1").update(controlBody).digest("hex");
      const controlName = `verification/control-unlocked-${controlSha1.slice(0, 12)}.txt`;
      const controlUrl = await b2(`${api.apiUrl}/b2api/v3/b2_get_upload_url`, account.authorizationToken, {
        bucketId: bucket.bucketId,
      });
      const controlPut = await fetch(controlUrl.json.uploadUrl, {
        method: "POST",
        headers: {
          Authorization: controlUrl.json.authorizationToken,
          "X-Bz-File-Name": encodeURIComponent(controlName),
          "Content-Type": "text/plain",
          "Content-Length": String(controlBody.length),
          "X-Bz-Content-Sha1": controlSha1,
        },
        body: controlBody,
      });
      const controlUploaded = await controlPut.json();
      const controlDelete = await b2(
        `${api.apiUrl}/b2api/v3/b2_delete_file_version`,
        account.authorizationToken,
        { fileName: controlUploaded.fileName, fileId: controlUploaded.fileId },
      );
      if (controlDelete.ok) {
        console.log("  control: an UNLOCKED object deleted cleanly with the same key");
        console.log("  => the refusal above came from COMPLIANCE retention, not from permissions");
      } else {
        console.log(`  control: an unlocked object ALSO could not be deleted (HTTP ${controlDelete.status})`);
        console.log("  => the refusal above proves nothing; investigate permissions before trusting this bucket");
        failures.push("control delete failed, so lock enforcement is unproven");
      }
    }
  }

  console.log(`\n${"=".repeat(64)}`);
  if (failures.length) {
    console.log(`DESTINATION NOT READY (${failures.length}):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("DESTINATION READY" + (proveLock ? " — immutability proven by test" : " — settings only, run --prove-lock to prove it"));
}

await main();
