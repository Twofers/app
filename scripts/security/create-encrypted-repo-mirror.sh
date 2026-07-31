#!/usr/bin/env bash
set -euo pipefail
umask 077

required=(BACKUP_AGE_RECIPIENT BACKUP_S3_BUCKET)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 2
  fi
done

s3_endpoint_args=()
if [[ -n "${BACKUP_S3_ENDPOINT_URL:-}" ]]; then
  s3_endpoint_args+=(--endpoint-url "$BACKUP_S3_ENDPOINT_URL")
fi
max_stored_bytes="${BACKUP_MAX_STORED_BYTES:-9500000000}"
if [[ ! "$max_stored_bytes" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_MAX_STORED_BYTES must be a positive integer" >&2
  exit 2
fi

git rev-parse --is-inside-work-tree >/dev/null

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
mirror_stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
bundle="$work_dir/twofer-repository-$mirror_stamp.bundle"
encrypted="$bundle.age"

# --all includes every local branch, tag, and other reference. This workstation
# job is therefore the complement to the remote-only GitHub backup workflow.
git bundle create "$bundle" --all
git bundle verify "$bundle"

age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted" "$bundle"
sha256sum "$encrypted" > "$encrypted.sha256"

storage_summary="$(
  aws s3 ls "s3://$BACKUP_S3_BUCKET" \
    --recursive \
    --summarize \
    "${s3_endpoint_args[@]}"
)"
stored_bytes="$(awk -F': ' '/^Total Size:/ { print $2 }' <<< "$storage_summary" | tail -n 1)"
encrypted_bytes="$(wc -c < "$encrypted" | tr -d '[:space:]')"
checksum_bytes="$(wc -c < "$encrypted.sha256" | tr -d '[:space:]')"
if [[ ! "$stored_bytes" =~ ^[0-9]+$ ]]; then
  echo "Could not verify current backup-bucket storage; refusing upload" >&2
  exit 3
fi
projected_stored_bytes="$((stored_bytes + encrypted_bytes + checksum_bytes))"
if [[ "$projected_stored_bytes" -gt "$max_stored_bytes" ]]; then
  echo "Projected backup-bucket storage is $projected_stored_bytes bytes; refusing upload above BACKUP_MAX_STORED_BYTES=$max_stored_bytes" >&2
  exit 3
fi

retain_until="$(date -u -d '+365 days' +%Y-%m-%dT%H:%M:%SZ)"
key="repository-mirrors/$(date -u +%Y/%m)/$(basename "$encrypted")"

for object in "$encrypted" "$encrypted.sha256"; do
  suffix=""
  if [[ "$object" == *.sha256 ]]; then suffix=".sha256"; fi
  aws s3api put-object \
    --bucket "$BACKUP_S3_BUCKET" \
    --key "$key$suffix" \
    --body "$object" \
    --object-lock-mode COMPLIANCE \
    --object-lock-retain-until-date "$retain_until" \
    "${s3_endpoint_args[@]}" >/dev/null
done

echo "Encrypted all-refs repository mirror uploaded: $key"
