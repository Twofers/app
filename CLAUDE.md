# Agent instructions for the TWOFER repo

Save this file at the repo root. Claude Code reads `CLAUDE.md` automatically each session. Codex reads `AGENTS.md`. Keep the two files identical so whichever agent runs gets the same rules.

## Current source of truth

The codebase is ahead of the old root handoff spec. Use the actual code as the source of truth. If docs conflict with code, code wins and you must report the conflict instead of silently following stale instructions.

Start each task with a read-only audit of the files and docs that apply to that task:

- Current app/runtime shape: `docs/release-audit/current-state.md`
- Deploy and environment state: `docs/deployment-notes.md`, `docs/production-deploy-checklist.md`, `docs/deployment-command-plan.md`
- AI ad and AI Deal Studio state: `docs/ai-ad-current-state.md`, `docs/dev/AI_DEAL_STUDIO_DEV_APK_SETUP.md`, `docs/dev/AI_DEAL_STUDIO_SUPABASE_DEV_SETUP.md`, `docs/dev/AI_STUDIO_EDGE_FUNCTION_DEV_DEPLOY.md`
- Localization rollout: `docs/localization/multilingual-deals-production-approval-runbook.md` and the PR notes under `docs/localization/`
- Release/beta checks: `docs/beta-release-checklist.md`
- Historical baseline only: `twofer-developer-handoff-spec.md`. Sections 1 through 5 remain useful for product intent and hard gates, but it is not current enough to override code or newer docs.

Older handoff, plan, audit, and status documents under `outdated/` are history only. Do not work from them unless Dan explicitly asks for archaeology.

## Current app state as of 2026-06-29

- Stack: Expo SDK 54, React Native 0.81, React 19, TypeScript, Expo Router, Supabase Postgres/RLS/Storage/Edge Functions.
- App version is `1.0.0`; Android `versionCode` is currently 31 in `app.json`.
- Production package and bundle id remain `com.unvmex2.twoforone`.
- A dev AI Studio Android variant exists: app name `Twofer Dev`, package `com.unvmex2.twoforone.dev`, enabled by `TWOFER_APP_VARIANT=ai-studio-dev` or `EXPO_PUBLIC_APP_VARIANT=ai-studio-dev`.
- The current branch may contain active AI Deal Studio foundation work and local QA/store artifacts. Never delete untracked artifacts, screenshots, APKs, reports, or docs without asking.
- Share Deal is controlled by `EXPO_PUBLIC_ENABLE_SHARE_DEAL`, configured in `eas.json`, and read through `lib/runtime-env.ts`.
- Billing surfaces are currently enabled in code with `PAID_BILLING_ENABLED = true`; pilot enforcement is bypassed with `PILOT_DISABLE_BILLING_GATE = true`. Do not rely on old instructions that say billing is fully hidden behind `false`.
- AI Deal Studio dev publishing must stay disabled with `EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING=true`; dev builds must use a separate Supabase development project, not production.
- AI create paths are versioned/native-renderer oriented. The legacy `ai-create-deal` endpoint is intentionally disabled and should return HTTP 410.
- English, Spanish, and Korean are active localization targets. Any new user-facing copy must go through localization files.

## Locked product decisions still in force

Do not reopen these unless Dan explicitly changes them:

- Email/password sign-in only. No Sign in with Apple, social login, guest browsing, or anonymous browsing.
- Birthday is optional; location uses a 5-digit ZIP only.
- Age rating is 13+.
- iPad support is off; iPhone only for iOS.
- Share Deal ships in v1 on iOS and Android.
- v1/pilot has no ads and no data selling.
- Pilot businesses are capped to one location unless the current billing/location work explicitly changes that flow.
- Public support email is `support@twoferapp.com`.
- Hard Shopper/Business role split: role is picked at signup, stored in `profiles.role`, and login routes by stored/derived role. Do not reintroduce soft role switching.
- AI Compose voice audio is processed ephemerally and is not stored; only transcript/log metadata may be retained.
- Email confirmation stays on.

## How to work

1. Do one scoped task at a time. State the task and the plan in one line before you start.
2. Diagnose before building. Run a read-only audit and surface the issues you found before writing a fix.
3. Make the smallest useful change for the task. Avoid opportunistic refactors.
4. Preserve unrelated user or generated changes. This repo often has local QA artifacts and active work in progress.
5. Commit locally only when Dan asks for a commit. Never push.
6. Explain risky findings in plain language. Dan builds with AI assistance and is not a traditional engineer.

## Hard gates

Stop and get explicit approval before any of these:

- Building any release or production-like iOS/Android build.
- Submitting to TestFlight, App Store, or Google Play.
- Pushing, merging, tagging, resetting, or force-moving branches.
- Deploying the website.
- Changing version numbers, build numbers, bundle id, package id, app signing, keystores, or provisioning.
- Applying Supabase migrations or running `supabase db push`.
- Deploying Supabase Edge Functions to a hosted project.
- Changing production Supabase secrets, Stripe secrets, App Store Connect credentials, APNs credentials, Google services configuration, or EAS credentials.
- Exposing or printing any secret, auth token, push token, QR token, claim code, redemption code, API key, distribution certificate, provisioning profile, or full `google-services.json` contents.

Local QA screenshot exception: when Dan explicitly asks for app screenshots, screenshots saved only under local `artifacts/` or QA folders may include in-app QR codes, QR tokens, claim codes, or redemption codes so screens can be reviewed. Do not transcribe those values into chat, terminal output, docs, commits, PRs, or public artifacts; do not push them.

## Validation expectations

For code changes, run the checks that match the risk:

- Baseline: `npm run typecheck`, `npm run lint`, `npm test`.
- Edge functions: `npm run typecheck:functions` plus focused function/source tests.
- AI promotional-copy or prompt changes: baseline checks plus `npm run copy:evaluate`; update fixtures and regression tests.
- Billing/location/claim/RLS-sensitive work: run focused tests and the relevant gate scripts. After applying any migration that touches RLS policies or policy helper functions, immediately run `node scripts/probe-rls-smoke.mjs`.
- Release-candidate work: follow `docs/beta-release-checklist.md`.
- Metro/bundle probe: use an Expo/Metro probe appropriate to the changed surface; do not start a long-running server and leave it running.

If you cannot run a required check, say exactly why.

## Environment facts

- This is a Windows machine. You cannot build or sign iOS locally. iOS builds run on EAS cloud, and iOS device testing runs through TestFlight on a real iPhone.
- There is no local Supabase. Do not start one or assume one exists.
- Supabase production actions are hard-gated. Local SQL files may be edited, but applying them is not allowed without approval.
- When Dan explicitly requests local Android emulator QA, agents may use the emulator and local debug/dev-client Android commands such as `expo run:android`. Do not use `subst` or junction workarounds.
- Preserve EAS cloud credits. Prefer local Android/debug validation where possible, but do not build release artifacts without approval.
- For AI Studio dev APK work, follow `docs/dev/AI_DEAL_STUDIO_DEV_APK_SETUP.md` and keep the dev package separate from production.

## AI and offer rules

- AI poster/ad generation is a core locked feature. Before changing AI poster layout, AI ad prompts, AI ad image generation, offer-to-poster copy, AI create review/publish behavior, or the lock files themselves, stop and get Dan's explicit approval for each file individually. The agent must list the exact file, the intended behavior change, validation impact, and any deploy impact before editing. Broad approval such as "fix AI" is not enough. Follow `docs/ai-poster-core-lock.md` and keep `docs/ai-poster-core-lock.json` current after approved changes.
- Deal facts are authoritative; creativity must never alter them.
- Headlines must explain the customer action and reward naturally.
- Do not solve copy-quality bugs with example-specific string replacements.
- Every prompt change requires fixture updates and regression tests.
- AI output must pass validation and have a deterministic fallback.
- Provider failures must not expose raw upstream response bodies or secrets.
- Generated images must not bake critical offer text, QR codes, logos, or private data into pixels unless the current native-renderer spec explicitly allows it.

## Out of scope for agents

Draft instructions or text for Dan, but do not perform these directly:

- Apple Developer Program enrollment.
- App Store Connect and Play Console forms.
- Store screenshots from a real iOS device or iOS simulator.
- TestFlight install and on-device iPhone testing.
- Approval of builds, submissions, migrations, or deployments.
