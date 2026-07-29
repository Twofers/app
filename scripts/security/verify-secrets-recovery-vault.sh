#!/usr/bin/env bash
set -euo pipefail
umask 077

encrypted="${1:?Usage: verify-secrets-recovery-vault.sh <vault.tar.age> <age-identity>}"
identity="${2:?Usage: verify-secrets-recovery-vault.sh <vault.tar.age> <age-identity>}"

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
archive="$work_dir/vault.tar"
payload="$work_dir/payload"
mkdir -p "$payload"

age --decrypt --identity "$identity" --output "$archive" "$encrypted"
if tar -tf "$archive" | awk '
  /^\// { bad=1 }
  /(^|\/)\.\.(\/|$)/ { bad=1 }
  END { exit bad ? 0 : 1 }
'; then
  echo "Vault archive contains an unsafe extraction path." >&2
  exit 3
fi
tar -C "$payload" --no-same-owner --no-same-permissions -xf "$archive"
(
  cd "$payload"
  sha256sum --check SHA256SUMS
)
test -f "$payload/recovery-instructions.md"

echo "Recovery vault decrypted and all internal checksums verified."
