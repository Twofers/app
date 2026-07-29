import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const storageRoot = path.resolve(process.argv[2] || "");
if (!process.argv[2]) {
  throw new Error(
    "Usage: node scripts/security/verify-disposable-project.mjs <extracted-storage-directory>",
  );
}

const required = [
  "RESTORE_SUPABASE_URL",
  "RESTORE_SUPABASE_ANON_KEY",
  "RESTORE_SUPABASE_SERVICE_ROLE_KEY",
  "DISPOSABLE_SUPABASE_PROJECT_REF",
  "PRODUCTION_SUPABASE_PROJECT_REF",
  "RESTORE_TEST_EMAIL",
  "RESTORE_TEST_PASSWORD",
  "RESTORE_TEST_FUNCTION",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}
if (process.env.ALLOW_DISPOSABLE_RESTORE !== "true") {
  throw new Error("Set ALLOW_DISPOSABLE_RESTORE=true to verify a disposable project.");
}

const restoreUrl = new URL(process.env.RESTORE_SUPABASE_URL);
const disposableRef = process.env.DISPOSABLE_SUPABASE_PROJECT_REF;
const productionRef = process.env.PRODUCTION_SUPABASE_PROJECT_REF;
if (disposableRef === productionRef) {
  throw new Error("Disposable and production project refs must differ.");
}
if (restoreUrl.hostname.split(".")[0] !== disposableRef) {
  throw new Error("RESTORE_SUPABASE_URL does not match DISPOSABLE_SUPABASE_PROJECT_REF.");
}
if (
  process.env.SUPABASE_URL &&
  new URL(process.env.SUPABASE_URL).hostname === restoreUrl.hostname
) {
  throw new Error("Restore verification refuses to target the configured primary Supabase URL.");
}

const anon = createClient(
  restoreUrl.toString().replace(/\/$/, ""),
  process.env.RESTORE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const admin = createClient(
  restoreUrl.toString().replace(/\/$/, ""),
  process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const manifestPath = path.join(storageRoot, "storage-manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest?.buckets)) throw new Error("Invalid Storage manifest.");

function safeSegment(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value === "." ||
    value === ".." ||
    /[\\/\0]/.test(value)
  ) {
    throw new Error("Unsafe Storage manifest path segment.");
  }
  return value;
}

const { data: existingBuckets, error: bucketListError } = await admin.storage.listBuckets();
if (bucketListError) throw bucketListError;
const existingNames = new Set((existingBuckets || []).map((bucket) => bucket.name));
const storageChecks = [];

for (const bucket of manifest.buckets) {
  const bucketName = safeSegment(bucket.name);
  if (!existingNames.has(bucketName)) {
    const { error } = await admin.storage.createBucket(bucketName, {
      public: bucket.public === true,
      fileSizeLimit: bucket.file_size_limit || undefined,
      allowedMimeTypes: bucket.allowed_mime_types || undefined,
    });
    if (error) throw error;
  }

  const sample = Array.isArray(bucket.objects) ? bucket.objects[0] : null;
  if (!sample) {
    storageChecks.push({ bucket: bucketName, result: "empty-source-bucket" });
    continue;
  }
  const objectSegments = String(sample.path).split("/").map(safeSegment);
  const objectPath = objectSegments.join("/");
  const source = path.join(storageRoot, bucketName, ...objectSegments);
  const bytes = await fs.readFile(source);
  const localHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (localHash !== sample.sha256 || bytes.length !== sample.size) {
    throw new Error(`Local backup sample is corrupt: ${bucketName}/${objectPath}`);
  }

  const { error: uploadError } = await admin.storage
    .from(bucketName)
    .upload(objectPath, bytes, { upsert: true });
  if (uploadError) throw uploadError;
  const { data: downloaded, error: downloadError } = await admin.storage
    .from(bucketName)
    .download(objectPath);
  if (downloadError) throw downloadError;
  const restored = Buffer.from(await downloaded.arrayBuffer());
  const restoredHash = crypto.createHash("sha256").update(restored).digest("hex");
  if (restoredHash !== sample.sha256 || restored.length !== sample.size) {
    throw new Error(`Restored Storage sample mismatch: ${bucketName}/${objectPath}`);
  }
  storageChecks.push({
    bucket: bucketName,
    path: objectPath,
    size: sample.size,
    sha256: sample.sha256,
    result: "verified",
  });
}

const { data: authData, error: authError } = await anon.auth.signInWithPassword({
  email: process.env.RESTORE_TEST_EMAIL,
  password: process.env.RESTORE_TEST_PASSWORD,
});
if (authError || !authData.user || !authData.session?.access_token) {
  throw authError || new Error("Restored Auth login did not produce a session.");
}

let functionBody = {};
if (process.env.RESTORE_TEST_FUNCTION_BODY) {
  functionBody = JSON.parse(process.env.RESTORE_TEST_FUNCTION_BODY);
}
const functionName = process.env.RESTORE_TEST_FUNCTION;
if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(functionName)) {
  throw new Error("RESTORE_TEST_FUNCTION is not a valid Edge Function slug.");
}
const functionResponse = await fetch(
  `${restoreUrl.toString().replace(/\/$/, "")}/functions/v1/${encodeURIComponent(
    functionName,
  )}`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authData.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(functionBody),
  },
);
const allowedStatuses = new Set(
  String(process.env.RESTORE_TEST_FUNCTION_ALLOWED_STATUSES || "200")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(Number.isInteger),
);
if (!allowedStatuses.has(functionResponse.status)) {
  throw new Error(
    `Restore-test Edge Function returned HTTP ${functionResponse.status}; expected ${[
      ...allowedStatuses,
    ].join(", ")}.`,
  );
}

const report = {
  verified_at: new Date().toISOString(),
  disposable_project_ref: disposableRef,
  storage: storageChecks,
  auth: {
    user_id: authData.user.id,
    result: "verified",
  },
  edge_function: {
    name: functionName,
    status: functionResponse.status,
    result: "verified",
  },
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (process.env.RESTORE_DRILL_REPORT_PATH) {
  await fs.writeFile(path.resolve(process.env.RESTORE_DRILL_REPORT_PATH), reportText, {
    flag: "wx",
    mode: 0o600,
  });
}
process.stdout.write(reportText);
