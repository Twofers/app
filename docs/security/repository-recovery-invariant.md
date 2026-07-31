# Repository recovery invariant

The standing rule is:

> A production artifact must be built from a reviewed commit, that commit must
> be present on the approved remote, and the deployed version must record the
> same commit: **deployed = committed = pushed**.

## Snapshot on 2026-07-29

- Current branch `qa/poster-ad-quality` was exactly even with its upstream at
  commit `6d6858bbffa25468f3d366946813efe99f203c33` before this local hardening
  work began.
- The repository contains 267 local branches: 192 have no upstream, 18 are
  ahead of an upstream, 55 are in sync, and 2 are behind-only.
- There are 29 registered worktrees.
- This is a material recovery backlog. It must not be “cleaned up” by deletion;
  branch ownership and merge value must be reviewed first.

## Before every deploy

1. Require a clean working tree for the deploy worktree.
2. Record `git rev-parse HEAD`, branch, remote URL, and `git status --porcelain`.
3. Require `git rev-list --left-right --count HEAD...@{upstream}` to be `0 0`.
4. Build/deploy only that SHA; save provider deployment IDs and Edge Function
   versions beside the SHA.
5. Re-run migration parity and record the output.
6. Reject console-edited or locally deployed code that cannot be reproduced
   from that remote SHA.

## Off-GitHub mirror

`scripts/security/create-encrypted-repo-mirror.sh` creates a `git bundle --all`,
verifies it, encrypts it with age, and uploads the bundle and checksum to
compliance-mode Object Lock for one year. Run it on this workstation so
local-only branches are included; a GitHub runner cannot see them.

The script does not capture uncommitted files. Preserve meaningful uncommitted
work as reviewed commits before the mirror, without combining unrelated
worktrees or authors.

For the zero-cost bootstrap posture, the off-GitHub mirror remains local and
encrypted unless its size plus retained database/Storage backups fits within
the separate provider's free 10 GB allowance. `BACKUP_S3_ENDPOINT_URL` lets the
script use the approved S3-compatible Backblaze B2 endpoint.
