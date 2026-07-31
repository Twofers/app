import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const destination = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: node export-storage.mjs <destination>");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: buckets, error: bucketsError } = await client.storage.listBuckets();
if (bucketsError) throw bucketsError;

const manifest = {
  generated_at: new Date().toISOString(),
  buckets: [],
};

function safeSegment(value) {
  if (!value || value === "." || value === ".." || /[\\/\0]/.test(value)) {
    throw new Error("Unsafe Storage object path segment.");
  }
  return value;
}

async function exportFolder(bucketName, prefix = "") {
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage
      .from(bucketName)
      .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    objects.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const records = [];
  for (const object of objects) {
    const name = safeSegment(object.name);
    const objectPath = prefix ? `${prefix}/${name}` : name;
    if (object.id == null) {
      records.push(...await exportFolder(bucketName, objectPath));
      continue;
    }
    const { data, error } = await client.storage.from(bucketName).download(objectPath);
    if (error) throw error;
    const bytes = Buffer.from(await data.arrayBuffer());
    const localPath = path.join(destination, safeSegment(bucketName), ...objectPath.split("/").map(safeSegment));
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, bytes);
    records.push({
      path: objectPath,
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return records;
}

await fs.mkdir(destination, { recursive: true });
for (const bucket of buckets || []) {
  const name = safeSegment(bucket.name);
  const objects = await exportFolder(name);
  manifest.buckets.push({
    id: bucket.id,
    name,
    public: bucket.public,
    file_size_limit: bucket.file_size_limit,
    allowed_mime_types: bucket.allowed_mime_types,
    objects,
  });
  console.log(`Exported bucket ${name}: ${objects.length} objects.`);
}

await fs.writeFile(
  path.join(destination, "storage-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
