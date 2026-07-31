#!/usr/bin/env bash
set -euo pipefail
umask 077

input_dir="${1:?Usage: create-secrets-recovery-vault.sh <input-directory> <age-recipient> <output.tar.age>}"
recipient="${2:?Usage: create-secrets-recovery-vault.sh <input-directory> <age-recipient> <output.tar.age>}"
output="${3:?Usage: create-secrets-recovery-vault.sh <input-directory> <age-recipient> <output.tar.age>}"

repo_root="$(git rev-parse --show-toplevel)"
input_abs="$(realpath "$input_dir")"
output_parent="$(realpath "$(dirname "$output")")"
output_abs="$output_parent/$(basename "$output")"

case "$input_abs/" in
  "$repo_root/"*) echo "Secret-vault input must be outside the Git worktree." >&2; exit 3 ;;
esac
case "$output_abs" in
  "$repo_root/"*) echo "Encrypted vault output must be outside the Git worktree." >&2; exit 3 ;;
esac
if [[ -e "$output_abs" || -e "$output_abs.sha256" ]]; then
  echo "Refusing to overwrite an existing vault or checksum." >&2
  exit 4
fi
if [[ -n "$(find "$input_abs" -type l -print -quit)" ]]; then
  echo "Secret-vault input must not contain symbolic links." >&2
  exit 5
fi
if [[ -n "$(find "$input_abs" ! -type f ! -type d -print -quit)" ]]; then
  echo "Secret-vault input may contain only regular files and directories." >&2
  exit 5
fi
if [[ ! -f "$input_abs/recovery-instructions.md" ]]; then
  echo "Input must include recovery-instructions.md with owners and re-issue steps." >&2
  exit 6
fi

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT
payload="$work_dir/payload"
archive="$work_dir/secrets-recovery-vault.tar"
mkdir -p "$payload"
cp -a "$input_abs/." "$payload/"

(
  cd "$payload"
  find . -type f ! -name SHA256SUMS -print0 |
    sort -z |
    xargs -0 sha256sum > SHA256SUMS
)
tar -C "$payload" -cf "$archive" .
age --recipient "$recipient" --output "$output_abs" "$archive"
sha256sum "$output_abs" > "$output_abs.sha256"

echo "Encrypted recovery vault created outside Git: $output_abs"
