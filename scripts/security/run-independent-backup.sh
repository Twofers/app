#!/usr/bin/env bash
set -euo pipefail
umask 077

required=(
  SUPABASE_DB_URL
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  BACKUP_AGE_RECIPIENT
  BACKUP_S3_BUCKET
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 2
  fi
done

daily_retention_days="${BACKUP_DAILY_RETENTION_DAYS:-7}"
monthly_retention_days="${BACKUP_MONTHLY_RETENTION_DAYS:-90}"
max_archive_bytes="${BACKUP_MAX_ARCHIVE_BYTES:-900000000}"
max_stored_bytes="${BACKUP_MAX_STORED_BYTES:-9500000000}"
for value_name in daily_retention_days monthly_retention_days max_archive_bytes max_stored_bytes; do
  value="${!value_name}"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "$value_name must be a positive integer" >&2
    exit 2
  fi
done

s3_endpoint_args=()
if [[ -n "${BACKUP_S3_ENDPOINT_URL:-}" ]]; then
  s3_endpoint_args+=(--endpoint-url "$BACKUP_S3_ENDPOINT_URL")
fi

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
backup_stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
payload_dir="$work_dir/payload"
mkdir -p "$payload_dir/database" "$payload_dir/config" "$payload_dir/storage"

pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$payload_dir/database/supabase.dump"

if [[ "$(psql "$SUPABASE_DB_URL" -X --no-psqlrc --tuples-only --no-align \
  --command "select to_regclass('cron.job') is not null")" == "t" ]]; then
  psql "$SUPABASE_DB_URL" -X --no-psqlrc --set ON_ERROR_STOP=1 \
    --command "copy (select row_to_json(j) from cron.job j order by jobid) to stdout" \
    > "$payload_dir/config/cron-jobs.jsonl"
else
  printf '%s\n' '{"status":"pg_cron_not_installed"}' \
    > "$payload_dir/config/cron-jobs.jsonl"
fi
psql "$SUPABASE_DB_URL" -X --no-psqlrc --set ON_ERROR_STOP=1 \
  --command "copy (select extname, extversion from pg_extension order by extname) to stdout with csv header" \
  > "$payload_dir/config/database-extensions.csv"

node scripts/security/export-storage.mjs "$payload_dir/storage"

{
  printf 'backup_created_at=%s\n' "$backup_stamp"
  printf 'git_commit=%s\n' "$(git rev-parse HEAD)"
  printf 'node_version=%s\n' "$(node --version)"
  printf 'pg_dump_version=%s\n' "$(pg_dump --version)"
} > "$payload_dir/config/backup-metadata.txt"

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/functions" \
    > "$payload_dir/config/edge-functions.json"
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/secrets" \
    > "$payload_dir/config/secret-metadata.json"
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
    > "$payload_dir/config/auth-settings.json"
fi

if [[ -n "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ZONE_ID:-}" ]]; then
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/dns_records?per_page=5000" \
    > "$payload_dir/config/cloudflare-dns-records.json"
fi

if [[ -n "${STRIPE_BACKUP_RESTRICTED_KEY:-}" ]]; then
  curl --fail --silent --show-error \
    -H "Authorization: Bearer $STRIPE_BACKUP_RESTRICTED_KEY" \
    "https://api.stripe.com/v1/webhook_endpoints?limit=100" \
    > "$payload_dir/config/stripe-webhook-endpoints.json"
fi

cp docs/security/secrets-inventory.md "$payload_dir/config/secrets-inventory.md"
cp docs/security/public-edge-function-inventory.md "$payload_dir/config/public-edge-function-inventory.md"
cp docs/security/storage-bucket-inventory.md "$payload_dir/config/storage-bucket-inventory.md"

(
  cd "$payload_dir"
  find . -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

archive="$work_dir/twofer-backup-$backup_stamp.tar"
encrypted="$archive.age"
tar -C "$payload_dir" -cf "$archive" .
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted" "$archive"
sha256sum "$encrypted" > "$encrypted.sha256"

archive_bytes="$(wc -c < "$encrypted" | tr -d '[:space:]')"
if [[ ! "$archive_bytes" =~ ^[1-9][0-9]*$ || "$archive_bytes" -gt "$max_archive_bytes" ]]; then
  echo "Encrypted backup is ${archive_bytes:-unknown} bytes; refusing upload above BACKUP_MAX_ARCHIVE_BYTES=$max_archive_bytes" >&2
  exit 3
fi

checksum_bytes="$(wc -c < "$encrypted.sha256" | tr -d '[:space:]')"
storage_summary="$(
  aws s3 ls "s3://$BACKUP_S3_BUCKET" \
    --recursive \
    --summarize \
    "${s3_endpoint_args[@]}"
)"
stored_bytes="$(awk -F': ' '/^Total Size:/ { print $2 }' <<< "$storage_summary" | tail -n 1)"
if [[ ! "$stored_bytes" =~ ^[0-9]+$ ]]; then
  echo "Could not verify current backup-bucket storage; refusing upload" >&2
  exit 3
fi
upload_copies=1
if [[ "$(date -u +%d)" == "01" ]]; then
  upload_copies=2
fi
projected_stored_bytes="$((stored_bytes + upload_copies * (archive_bytes + checksum_bytes)))"
if [[ "$projected_stored_bytes" -gt "$max_stored_bytes" ]]; then
  echo "Projected backup-bucket storage is $projected_stored_bytes bytes; refusing upload above BACKUP_MAX_STORED_BYTES=$max_stored_bytes" >&2
  exit 3
fi

verify_locked_object() {
  local object_key="$1"
  local size mode retain_until
  read -r size mode retain_until <<< "$(
    aws s3api head-object \
      --bucket "$BACKUP_S3_BUCKET" \
      --key "$object_key" \
      --query '[ContentLength,ObjectLockMode,ObjectLockRetainUntilDate]' \
      --output text \
      "${s3_endpoint_args[@]}"
  )"
  if [[ ! "$size" =~ ^[1-9][0-9]*$ || "$mode" != "COMPLIANCE" || -z "$retain_until" || "$retain_until" == "None" ]]; then
    echo "Uploaded backup object is missing expected immutable retention: $object_key" >&2
    exit 4
  fi
}

daily_retain_until="$(date -u -d "+$daily_retention_days days" +%Y-%m-%dT%H:%M:%SZ)"
daily_key="daily/$(date -u +%Y/%m/%d)/$(basename "$encrypted")"
aws s3api put-object \
  --bucket "$BACKUP_S3_BUCKET" \
  --key "$daily_key" \
  --body "$encrypted" \
  --object-lock-mode COMPLIANCE \
  --object-lock-retain-until-date "$daily_retain_until" \
  "${s3_endpoint_args[@]}" >/dev/null
aws s3api put-object \
  --bucket "$BACKUP_S3_BUCKET" \
  --key "$daily_key.sha256" \
  --body "$encrypted.sha256" \
  --object-lock-mode COMPLIANCE \
  --object-lock-retain-until-date "$daily_retain_until" \
  "${s3_endpoint_args[@]}" >/dev/null
verify_locked_object "$daily_key"
verify_locked_object "$daily_key.sha256"

if [[ "$(date -u +%d)" == "01" ]]; then
  monthly_retain_until="$(date -u -d "+$monthly_retention_days days" +%Y-%m-%dT%H:%M:%SZ)"
  monthly_key="monthly/$(date -u +%Y/%m)/$(basename "$encrypted")"
  aws s3api put-object \
    --bucket "$BACKUP_S3_BUCKET" \
    --key "$monthly_key" \
    --body "$encrypted" \
    --object-lock-mode COMPLIANCE \
    --object-lock-retain-until-date "$monthly_retain_until" \
    "${s3_endpoint_args[@]}" >/dev/null
  aws s3api put-object \
    --bucket "$BACKUP_S3_BUCKET" \
    --key "$monthly_key.sha256" \
    --body "$encrypted.sha256" \
    --object-lock-mode COMPLIANCE \
    --object-lock-retain-until-date "$monthly_retain_until" \
    "${s3_endpoint_args[@]}" >/dev/null
  verify_locked_object "$monthly_key"
  verify_locked_object "$monthly_key.sha256"
fi

if [[ -n "${BACKUP_SUCCESS_HEARTBEAT_URL:-}" ]]; then
  curl --fail --silent --show-error \
    --request POST \
    --header "Content-Type: application/json" \
    --data "{\"status\":\"ok\",\"backup\":\"$daily_key\",\"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    "$BACKUP_SUCCESS_HEARTBEAT_URL" >/dev/null
fi

echo "Independent encrypted backup uploaded: $daily_key"
