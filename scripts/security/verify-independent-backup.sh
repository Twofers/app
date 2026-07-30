#!/usr/bin/env bash
set -euo pipefail
umask 077

encrypted="${1:?Usage: verify-independent-backup.sh <backup.tar.age> <age-identity> [disposable-db-url]}"
identity="${2:?Usage: verify-independent-backup.sh <backup.tar.age> <age-identity> [disposable-db-url]}"
restore_db_url="${3:-}"

# A restore can include production data. Require transport encryption for the
# explicitly approved disposable target as well.
export PGSSLMODE=require

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
archive="$work_dir/backup.tar"
payload="$work_dir/payload"
mkdir -p "$payload"

age --decrypt --identity "$identity" --output "$archive" "$encrypted"
tar -C "$payload" -xf "$archive"
(
  cd "$payload"
  sha256sum --check SHA256SUMS
)
pg_restore --list "$payload/database/supabase.dump" >/dev/null

node --input-type=module - "$payload/storage/storage-manifest.json" "$payload/storage" <<'NODE'
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const [manifestPath, storageRoot] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const bucket of manifest.buckets) {
  for (const object of bucket.objects) {
    const file = path.join(storageRoot, bucket.name, ...object.path.split("/"));
    const bytes = fs.readFileSync(file);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (hash !== object.sha256 || bytes.length !== object.size) {
      throw new Error(`Storage checksum mismatch: ${bucket.name}/${object.path}`);
    }
  }
}
console.log("Storage manifest verified.");
NODE

if [[ -n "$restore_db_url" ]]; then
  if [[ "${ALLOW_DISPOSABLE_RESTORE:-}" != "true" ]]; then
    echo "Set ALLOW_DISPOSABLE_RESTORE=true to restore into the explicitly supplied disposable database." >&2
    exit 3
  fi
  disposable_ref="${DISPOSABLE_SUPABASE_PROJECT_REF:?Set DISPOSABLE_SUPABASE_PROJECT_REF for restore safety.}"
  production_ref="${PRODUCTION_SUPABASE_PROJECT_REF:?Set PRODUCTION_SUPABASE_PROJECT_REF for restore safety.}"
  if [[ "$disposable_ref" == "$production_ref" || "${SUPABASE_DB_URL:-}" == "$restore_db_url" ]]; then
    echo "Disposable restore target must differ from production." >&2
    exit 4
  fi
  node --input-type=module - "$restore_db_url" "$disposable_ref" "$production_ref" <<'NODE'
const [databaseUrl, disposableRef, productionRef] = process.argv.slice(2);
const parsed = new URL(databaseUrl);
const identity = `${parsed.hostname} ${decodeURIComponent(parsed.username)}`;
if (!identity.includes(disposableRef) || identity.includes(productionRef)) {
  throw new Error("Database URL does not prove the explicitly named disposable project ref.");
}
NODE
  pg_restore \
    --dbname "$restore_db_url" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    "$payload/database/supabase.dump"
fi

echo "Backup structure and checksums verified."
