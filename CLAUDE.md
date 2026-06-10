# Agent instructions for the TWOFER repo

Save this file at the repo root. Claude Code reads CLAUDE.md automatically each session. Codex reads AGENTS.md. Keep an identical copy under both names so whichever agent runs picks it up.

## What you are working from

The single source of truth is `twofer-developer-handoff-spec.md` at the repo root. Read it before doing anything, especially sections 1 through 5: locked decisions, current build and submission state, reference identifiers, open items needing confirmation, and the working rules. Sections 6 through 29 are the full product spec, organized by area.

If anything in the spec conflicts with the actual code, the code wins. Report the conflict instead of silently following the doc.

Older handoff, plan, audit, and status documents have been moved to the `outdated/` folder. Do not work from them. Treat them as history only.

## Locked v1 decisions (spec section 1)

These are settled. Do not reopen, redesign around, or ask about them.

- Email and password sign-in only. No Sign in with Apple, no social login, no guest or anonymous browsing.
- Birthday is optional, not required.
- Location uses a 5-digit ZIP only. No ZIP+4.
- Age rating is 13+ (infrequent possible alcohol references in deals).
- iPad support is off. `ios.supportsTablet` is false. iPhone only.
- Share Deal ships in v1 on both iOS and Android.
- v1 is a free pilot. No ads. No data sold.
- All paid surfaces are fully hidden behind `PAID_BILLING_ENABLED=false`. Nothing billing, pricing, upgrade, paywall, checkout, or subscription related is reachable in v1.
- Pilot businesses are capped to one location.

## Open items — do not guess (spec section 4)

Surface these and wait for Dan's decision. Never assume.

1. Which public support email is live: `support@twoferapp.com` or `twoferadmin@gmail.com`. Do not change any email reference until confirmed.
2. Whether accounts use a hard Shopper/Business role split or one account that reaches both sides. Verify against the code before building anything role-dependent.
3. The exact Share Deal feature-flag name. Inspect `eas.json` and the client code, then use that one name everywhere.
4. Whether the AI usage limits (30 generations per month, 2 regenerations per draft) are actually implemented in code.
5. Whether AI Compose voice audio is processed ephemerally or stored.
6. The fix approach for the broken TestFlight email-confirmation flow (spec section 17), before changing any auth behavior.

## How to work

1. Do one scoped task at a time. State which task you are on and your plan in one line before you start. Do not jump ahead.
2. Diagnose before building. Run a read-only audit and surface all issues before writing any fix. Review the whole fix set for interactions and regressions before applying anything.
3. Make the smallest possible change per task — one concern per commit. Commit locally only.
4. After each change, validate: `npx tsc --noEmit`, a Metro bundle probe, the test suite, and lint. When fixing an iOS-only bug, preserve existing Android behavior, and the reverse.
5. Show Dan the diff and the check results, then wait for approval before the next task.
6. Explain what you are doing in plain language. Dan builds with AI assistance and is not a traditional engineer. Flag anything risky before you do it.

## Hard gates — stop and get explicit approval before any of these (spec section 5)

- Building any release (iOS or Android).
- Submitting to TestFlight, App Store, or Play.
- Pushing, merging, tagging, or resetting any branch.
- Deploying the website.
- Changing version or build numbers.
- Changing the bundle id, package id, or signing.
- Applying any Supabase migration.
- Exposing or printing any secret: Supabase keys, the APNs .p8 key, the App Store Connect API key, push tokens, auth tokens, distribution certificates, provisioning profiles, full google-services.json contents, QR tokens, claim codes, or redemption codes.

## Standing rules

1. Work on a dedicated branch off a named safety checkpoint, as the spec directs. Creating local branches is fine; pushing, merging, tagging, or resetting is a hard gate above. Keep the working tree clean at each checkpoint.
2. Do not delete the untracked local QA and docs artifacts, or anything in `outdated/`, without asking.
3. Do not claim the app is production or store ready.

## Environment facts

- This is a Windows machine. You cannot build or sign an iOS app locally here. All iOS builds run on EAS cloud, and all iOS device testing runs through TestFlight on a real iPhone.
- The stack is Expo SDK 54, React Native, TypeScript, and Expo Router, with Supabase (Postgres and row level security, Deno edge functions, Storage).
- There is no local Supabase. Do not start one or assume one exists.
- Never run `expo run:android` or start an Android emulator on the dev machine. Do not use `subst` or junction workarounds. Prefer local Android builds and preserve the single remaining EAS cloud credit.

## Out of scope for you

You cannot do these. Draft what you can, then hand them to Dan:

- Apple Developer Program enrollment.
- App Store Connect and Play Console forms. Draft the exact text; Dan pastes it.
- Screenshots from a real device or simulator.
- TestFlight install and on-device testing.
- Approving builds and submissions.
