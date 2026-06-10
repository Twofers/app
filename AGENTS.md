# Agent instructions for the TWOFER repo

Save this file at the repo root. Claude Code reads CLAUDE.md automatically each session. Codex reads AGENTS.md. Put a copy under both names so whichever agent runs picks it up.

## What you are working from

The release plan is `docs/twofer-ios-app-store-submission-plan-20260607.md`. Read it before doing anything. Work it in plan order. Each task has an objective, the files involved, a do not list, and an acceptance check.

## Decisions locked, 2026-06-07

These are settled. Do not reopen or ask about them.

- Apple Developer account: enrolled, individual.
- Sign in with Apple: not needed. Email and password login only. Skip Task 2.6.
- Billing: v1 is free. Disable the Pro, Premium, and Billing surfaces, see Task 2.11. No Apple In App Purchase. Store copy and privacy answers say there is no charge.
- iPad: off. Set ios.supportsTablet to false, see Task 2.12. iPhone only.
- Share Deal: ships in v1. Associated Domains and the apple-app-site-association file are in scope, see Tasks 2.7 and 3.3.
- Version and build number: still proposed and approved at Task 2.13, the only open versioning item.

## How to work

1. You may work through multiple non-gated tasks in one run without pausing. Follow plan order unless I tell you to jump.
2. State which task you are on in one line before each.
3. Commit each completed task locally on the current branch with a clear message. Never push.
4. Stop and wait for my explicit yes at every STOP GATE and before any hard-stop action in the standing rules: build, submit, publish public content, or signing, capability, entitlement, or profile change.
5. For DECISION tasks, do not guess. Ask me.
6. At each stop, summarize everything that changed across the batch and the acceptance checks.

## Standing rules, these override any task

1. Do not run a store bound build until a stop gate approves it.
2. Do not submit to App Store Connect or push to TestFlight until a stop gate approves it.
3. Do not change signing, bundle identifier, capabilities, entitlements, EAS profiles, or release config except inside a task that is explicitly preparing a build, and only after that task's stop gate.
4. Do not push, merge, tag, or release unless I approve it.
5. Do not apply Supabase migrations unless I asked for them and reviewed them.
6. Do not print secrets. No Supabase keys, push tokens, auth tokens, the APNs .p8 key, the App Store Connect API key, distribution certificates, provisioning profiles, full google-services.json contents, QR tokens, claim codes, or redemption codes.
7. Do not delete the untracked local QA and docs artifacts without asking.
8. Do not claim the app is production or store ready.
9. Work on the current branch only. Do not create branches without approval. Keep the working tree clean at each checkpoint.

## Environment facts

- This is a Windows machine. You cannot build or sign an iOS app locally here. iOS builds run on EAS cloud.
- The stack is Expo and React Native with Supabase. The owner builds with AI assistance and is not a traditional engineer, so explain what you are doing in plain language and flag anything risky before you do it.

## Out of scope for you

You cannot do these. Draft what you can, then hand them to me:
- Apple Developer Program enrollment.
- App Store Connect forms. Draft the exact text, I will paste it.
- Screenshots from a real device or simulator.
- TestFlight install and on device testing.
- Approving builds and submissions.
