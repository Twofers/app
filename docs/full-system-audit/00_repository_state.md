# Repository state

Audit date: 2026-07-11 (America/Chicago)

## Scope and method

This was a read-only technical and release-readiness audit of the repository, the live public website, and limited production inventory/failure paths. No application code, database rows, schema, hosted configuration, functions, secrets, deployments, builds, or external accounts were changed. The only writes are this audit package.

The actual code and current migrations were treated as authoritative. Older plans under `outdated/` were not used as current requirements.

## Starting state

- Repository: `C:\Users\unvme\Downloads\twoforone`
- Branch: `qa/db-guardrails-and-auth-tests`
- Commit: `f3f65b70b08b5ae7843bc3fa9de0caffa61ec558`
- Upstream: `origin/qa/db-guardrails-and-auth-tests`
- Remote: `https://github.com/Twofers/app.git`
- Working tree: clean
- Tracked files: 1,298
- Local migrations: 135
- Local Edge Function directories: 72, excluding `_shared`
- Expo app source files under `app/`: 39 TypeScript/TSX files

No separate historical website checkout was present at the older expected path. The current website source is the tracked `website/` directory in this repository, corroborated by `website/vercel.json`, current routes, and recent commits.

## Governing material reviewed

- `AGENTS.md`
- `docs/release-audit/current-state.md`
- `docs/deployment-notes.md`
- `docs/production-deploy-checklist.md`
- `docs/deployment-command-plan.md`
- `docs/ai-ad-current-state.md`
- `docs/dev/AI_DEAL_STUDIO_DEV_APK_SETUP.md`
- `docs/dev/AI_DEAL_STUDIO_SUPABASE_DEV_SETUP.md`
- `docs/dev/AI_STUDIO_EDGE_FUNCTION_DEV_DEPLOY.md`
- `docs/localization/multilingual-deals-production-approval-runbook.md` and current localization PR notes
- `docs/beta-release-checklist.md`
- `docs/ai-poster-core-lock.md` and its lock file
- `twofer-developer-handoff-spec.md` only as historical product-intent context

## Production read-only inventory

- Supabase migration ledger: all 135 local migrations have matching hosted ledger entries through `20260812140000`.
- Hosted functions: 73 active; all 72 local functions are active remotely.
- Drift: `ai-refine-ad-copy` is active remotely but has no local source directory. `docs/twofer-billing-remaining-work.md` independently notes that it was left deployed.
- Ledger equality is not proof that live policies, function bundles, secrets, or Auth settings exactly equal source. Those require separately authorized production inspection.

## Hard-gate boundaries observed

No release/production-like mobile build, store submission, website deploy, migration apply, Edge Function deploy, secret/config mutation, credential inspection, or authenticated production data workflow was attempted. No secret values are reproduced anywhere in this package.

## Ending state

- Branch: `qa/db-guardrails-and-auth-tests`
- Commit: `f3f65b70b08b5ae7843bc3fa9de0caffa61ec558`
- HEAD change during audit: none
- Repository changes observed: only the new untracked `docs/full-system-audit/` audit package created by this task
- Application/runtime files modified: none
- Unexpected concurrent repository changes: none observed
