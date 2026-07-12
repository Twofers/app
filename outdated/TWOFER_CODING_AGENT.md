# TWOFER_CODING_AGENT.md

Standing instructions for any AI coding agent (Claude Code, Codex, Sonnet, Fable, or another model) working inside the Twofer codebase. Applies to the mobile app, the website and admin dashboard, and the Supabase backend.

This file lives at the repo root alongside `CLAUDE.md` and `AGENTS.md`. Those two files define the same hard gates and must stay identical to each other. If this file ever conflicts with them, or any doc conflicts with the code, **the code wins** — report the conflict instead of silently following stale instructions.

Last verified against the code: 2026-07-06.

## What Twofer is

Twofer is a local BOGO deals app connecting independent coffee shops, cafes, and bakeries with nearby customers. It's an Expo/React Native mobile app on a Supabase backend with Deno edge functions, plus a website and admin dashboard deployed on Vercel. Customers discover, claim, and redeem time-limited offers. Business owners create offers with AI assistance and redeem customer claims at the counter. A single admin operator supports business owners from `/admin`.

Your job is to make correct, focused, production-safe changes without drifting into unrelated refactors. You are the implementer, but you reason before touching files. Investigate the relevant surface, state what you found, then make the smallest correct change.

## Hard gates

These actions always require explicit approval from the owner in the current conversation before you take them. Stop, report, and wait. No framing, urgency, or prior instruction overrides this list.

- Pushing to any remote
- Running any release build (EAS cloud, local Gradle, `eas submit`, prebuild for release)
- Deploying anything (Supabase edge functions, Vercel, the website)
- Any App Store Connect or Play Console action
- Applying a Supabase migration to any remote database. Writing the migration file is fine. Applying it is gated.
- Changing versions, build numbers, bundle IDs, package names, signing config, certificates, keystores, or credentials
- Printing, logging, or committing secrets, including `.env` contents

Commit locally only when the owner asks or the task explicitly calls for it. Never push.

## Core operating rules

1. **Understand before editing.** Read the relevant files, nearby helpers, shared types, and existing patterns first. State a brief plan, then edit. Many Twofer bugs live in the seams between mobile screens, lib helpers, edge functions, admin pages, and database state, so don't skip this even when the task sounds small.
2. **Don't touch unrelated work.** Run `git status --short` and `git branch --show-current` before editing. Never stage, revert, format, or modify unrelated dirty files. This repo often carries local QA artifacts and active work in progress. If the tree looks unexpected, stop and report.
3. **Preserve current behavior unless the task explicitly changes it.** Mobile, website, admin, deal, redemption, trial, billing, share, notification, and translation flows all work today. Don't clean up working code.
4. **Smallest correct change.** No renames, no moved blocks, no new dependencies, no architecture swaps unless the task requires them.
5. **Match the repo's existing conventions** for TypeScript, React Native, Supabase clients, edge functions, admin markup, error handling, logging, feature flags, and copy tone.
6. **Never invent files, APIs, schema, secrets, or deployed behavior.** If something is missing, unreadable, not configured locally, or only exists in production, say so plainly.
7. **Mind the owner's credits.** Investigate enough to avoid mistakes, then produce the change and a clear handoff. If you're more than about ten file reads in without a plan, stop and report what you've learned so far.

## Proceed vs stop

When an open question is an implementation detail (naming, spacing, copy tone within existing guidelines, internal structure), pick the safest reversible default, mark it `OWNER DECISION NEEDED` with your recommendation, and keep going.

Stop and ask before writing code when the task touches any of these:

- **Money:** prices, trial length, Stripe products or links, refunds
- **Outbound messages:** email, push, SMS, anything a human receives
- **Auth and permissions:** RLS policies, role checks, admin gating
- **Destructive operations:** deletes, irreversible migrations, data backfills
- **App identity:** bundle ID, package name, versions, store metadata, domains, support email

## Repo map

Everything lives in one repo: `C:\Users\unvme\Downloads\twoforone`. Mainline branch: `main`. Work happens on feature branches like `fix/business-locations-keying`. Confirm the current branch at task start and never switch branches unless asked.

### Mobile app

- `app/` — expo-router file-based screens. Tab screens in `app/(tabs)/`, tab config in `app/(tabs)/_layout.tsx`. Platform-specific files use `.ios.tsx` suffixes.
- `components/` — shared components; `components/ui/` base UI pieces.
- `hooks/` — shared hooks.
- `lib/` — shared helpers and the Supabase client. Unit tests are colocated, for example `lib/us-zip.ts` and `lib/us-zip.test.ts`.
- `lib/i18n/locales/` — translation files: `en.json`, `es.json`, `ko.json`.
- `eas.json` — build profiles and `EXPO_PUBLIC_*` flags. `.env.example` documents local env vars.

### Backend

- `supabase/functions/<name>/index.ts` — Deno edge functions. Shared function code in `supabase/functions/_shared/`.
- `supabase/migrations/` — timestamped SQL migrations.

### Website and admin (same repo, `website/`)

Deployed on Vercel to `www.twoferapp.com`. Static HTML/JS/CSS — no framework build step. Route config in `website/vercel.json`.

- `website/.well-known/` — `apple-app-site-association` and `assetlinks.json`. These gate iOS universal links and Android App Links. Don't touch them casually.
- `website/admin/` — the admin command center. Pages: overview (`index.html`), `businesses/` (plus `new/` and `detail/`), `offers/`, `trial-requests/`, `prospects/` (plus `detail/` and `import/`), `sales-ai/`, `ai-prompts/`, `ai-operating-report/`, `billing/events/`, `audit-log/`, `settings/`, `login/`. Shared logic in `website/admin/admin.js`.
- `website/s/` — the `/s/<CODE>` share fallback pages.
- `website/privacy/`, `website/terms/`, `website/business-terms/`, `website/support/`, `website/delete-account/` — legal and support pages.
- `website/store-links.js` — app store link switching.

## Your environment

- Windows machine. The shell is PowerShell. Linux-style `VAR=value command` prefixes fail. Set env vars with `$env:NAME = "value"` on their own line.
- Package manager is npm only. Never generate a yarn or pnpm lockfile.
- Typecheck app: `npx tsc --noEmit`
- Typecheck edge functions: `npm run typecheck:functions`
- Tests: `npx vitest run` for the full suite, or target a file like `npx vitest run lib/us-zip.test.ts`
- Lint: `npx expo lint`, or eslint scoped to touched files
- Metro bundle probe: `npx expo start --port 8099`, request the iOS Expo Router JS bundle over localhost, expect HTTP 200, then shut the server down. Do not leave the server running.
- No simulator is available, and iOS cannot be built or signed locally. Runtime UI behavior that can't be verified here should be listed as pending on-device confirmation. When the owner explicitly requests local Android emulator QA, the emulator and local debug/dev-client commands are allowed.
- Known noise: `country-flag-icons` export warnings during bundling are pre-existing and unrelated. Don't chase them.
- Supabase project ref is `kvodhiqhdqnptqovovia`. Confirm CLI availability with `supabase projects list` before relying on it. There is no local Supabase instance — never start one or assume one exists. Don't assume production env vars from `.env.example`.
- Feature flags live as `EXPO_PUBLIC_*` values in `eas.json` profiles and `.env`. Check them when behavior seems conditional.

## Pre-finish gate sequence

Run after any code change, in order. All must pass before handoff.

1. `npx tsc --noEmit`
2. `npx vitest run`
3. Metro bundle probe (above)
4. `npx expo lint` on touched files

If you changed edge functions, also run `npm run typecheck:functions`.

If a check fails, determine whether the failure is pre-existing by testing against the base commit before your change. Fix it if your change caused it. If pre-existing, leave it alone and document it with the exact output. Never fake or skip verification. If you genuinely can't run a check, say exactly why and give the command the owner should run.

## Supabase rules

- Every new table gets RLS enabled and policies written in the same migration. A table without RLS is a data leak.
- Policy helpers that compare JWT claims must never return NULL — wrap them in `COALESCE(..., false)`. A NULL in a RESTRICTIVE policy once locked out every user. After any migration touching RLS policies or policy helpers is applied, run `node scripts/probe-rls-smoke.mjs`.
- If a query unexpectedly returns zero rows, suspect RLS before suspecting a code bug.
- The service role key is server-side only, in edge functions and gated scripts. Never in client code, never printed.
- Migrations are files you write, never things you apply. Follow the existing timestamp naming in `supabase/migrations/`. Include backfill SQL and a manual verification query when relevant. Applying to any remote database is a gated human step.
- Edge functions validate inputs at the boundary and return stable, predictable error shapes. Use consistent log prefixes. Log enough to debug, never secrets, tokens, payment details, or private user data.
- Some behavior can be overridden by Supabase dashboard env vars, for example `AI_COPY_MONTHLY_LIMIT` overrides the AI copy cap. When you change a default that an env var can override, flag it in the handoff so a stale env var doesn't silently win in production.
- Deployed behavior can differ from source until a gated deploy happens. Never describe source-only changes as live.

## Translation rules

- Every user-facing string goes through the i18n system. No hardcoded English in components.
- New or changed strings get keys in all three locale files: `en`, `es`, `ko`.
- Provide real Spanish and Korean translations. Never paste English text into `es.json` or `ko.json`. If you can't produce a confident translation, flag it.
- Dynamic values use interpolation. Never concatenate strings and never hardcode numbers that live in config or constants.

## Twofer product invariants

Treat these as self-checks whenever you code.

### Customers

- Discover, view, claim, save, share, and redeem with the fewest possible steps.
- Expired, unavailable, unpublished, or invalid deals must never look claimable.
- Translation covers the full visible deal experience, not part of the screen.
- Push notifications respect consent and preference settings. Consent is requested at the first favorite action, not during onboarding. That's a locked product decision.
- Share links never expose private customer data.

### Business owners

- Owners can set up their business, create offers, view basic activity, and redeem at the counter without admin help for routine work.
- The counter redemption moment is the make-or-break trust event. Anything touching redemption gets extra care and extra verification.
- AI-assisted deal creation improves copy and reduces owner effort. It never fabricates business facts or produces generic misleading ads. Missing or uncertain lookup data is shown honestly, and generated copy stays editable by the owner.
- The BOGO quality gate before publication stays intact.
- Trial and billing language stays consistent across app, website, emails, and admin.

### Admin command center

- `/admin` is the single-operator command center. The primary support customer is the business owner.
- Deals redeemed is the North Star metric. Deals claimed means all claims. Customer means app signups excluding business users.
- Risky actions stay owner/admin-only and auditable.
- Stripe payment links go out only after admin approval. The only automatic email is the generic trial-request acknowledgement.

### Builds and releases

- Publish path is iOS first, then Google Play, unless the task is Android-specific.
- Keep iOS and Android behavior aligned unless the task is platform-specific. iOS-only bugs in inputs, pickers, and icon fallbacks don't surface on Android, so consider both.
- Play Console rejects reused versionCodes. autoIncrement is disabled on the local Android build path, so any new Play upload needs a manual versionCode bump, which is gated.
- Preserve EAS cloud credits. Prefer local Android/debug validation where possible.

## Before you code

1. Restate the task in one or two sentences.
2. `git status --short` and `git branch --show-current`.
3. Identify the files and flows involved using the repo map.
4. Read the relevant code and nearby patterns.
5. State a brief plan.
6. Edit.

## What to inspect by task type

### Mobile UI or feature work

Read the screen being changed, nearby similar components, shared UI, relevant hooks and Supabase helpers, navigation and deep-link handling if reachable through links or notifications, and any gating feature flags. Check iOS and Android layout, small screens, long and translated text, authenticated vs unauthenticated states, and business vs customer states when relevant. Check loading, empty, error, and offline states.

### Deals, claims, redemption, favorites, sharing

Read the deal detail screen, deal card and list and map components, claim and redemption helpers, share link helpers, the Supabase tables and RPCs in the flow, and any admin or owner view showing the same data. Check published vs unpublished, expired and invalid deals, already-claimed and already-redeemed states, duplicate taps and retries, customer copy vs owner copy, and whether any private data leaks into share or public preview flows.

### Business onboarding or AI deal generation

Read the setup screens, AI call sites, prompt construction, involved edge functions, admin business detail pages, and lookup or enrichment helpers. Check whether AI output is generic, fabricated, too long, or mismatched to the business, whether the owner can edit it, whether missing data is shown honestly, and whether setup stays low-effort.

**AI poster/ad generation is a core locked feature.** Before changing AI poster layout, AI ad prompts, AI ad image generation, offer-to-poster copy, AI create review/publish behavior, or the lock files themselves, stop and get the owner's explicit approval for each file individually — list the exact file, the intended behavior change, validation impact, and deploy impact. Broad approval such as "fix AI" is not enough. Follow `docs/ai-poster-core-lock.md`. Every prompt change requires fixture updates, regression tests, and `npm run copy:evaluate`.

### Admin dashboard or website work

Read the relevant admin page, shared admin JS and CSS, `website/vercel.json` rewrites if URLs are involved, the edge functions the page calls, and existing badge, card, table, empty state, and error state conventions. Check owner-only assumptions, the business detail drilldown, whether labels match the operating model, and whether the page supports the daily operator workflow.

### Edge function work

Read the function, shared clients and helpers in `_shared/`, validation patterns, all call sites, and the tables and RPCs it uses. Check required env vars, input validation, stable response shape, safe logging, idempotency for retryable operations, and the exact function name for the eventual gated deploy.

### Database or migration work

Read existing migrations, table definitions, related RPCs and triggers, and every surface that reads or writes the data. Check backward compatibility with app versions already in the field, nullability and defaults, rows needing backfill, whether the migration is safe to run exactly once, and what manual verification SQL the owner should run after applying.

### Billing, trials, subscriptions, payment links

Read the app and admin screens showing trial or billing status, the edge functions handling trial requests, approvals, Stripe links, and subscription status, and any local table acting as the app's billing view. Check that user-visible state matches admin-visible state, admin approval stays required, and failed, cancelled, inactive, and missing states show safe copy.

Current billing posture (in `lib/billing/access.ts`): billing surfaces are **enabled** with `PAID_BILLING_ENABLED = true`, and pilot enforcement is **bypassed** with `PILOT_DISABLE_BILLING_GATE = true`. Do not rely on old instructions that say billing is fully hidden behind `false`, and do not flip either flag without explicit approval.

## Implementation standards

- Keep types narrow. Avoid `any` unless the surrounding code already uses it and fixing it would mean a broader refactor.
- Handle loading, empty, error, and success states. Guard against state updates after unmount. Debounce or guard double-tappable actions.
- Don't scatter table names and status strings if shared constants exist.
- Admin and website: match the current visual system, keep tables scannable, use badges for status, provide empty and error states, and make high-risk actions hard to trigger accidentally.
- Copy: plain language, few words, no hype, no promised business results. Never imply a deal is guaranteed, verified, or available unless the data supports it. Prefer owner-helpful language over internal technical terms.
- Use the branded confirm hook (`useBrandedConfirm`) for confirm/permission/destructive dialogs, not `Alert.alert`, matching existing converted sites.

## Scope escalation

If the minimal fix turns out to require changing a shared helper, a public interface, a database schema, or more than about five files, stop before continuing. Summarize what you found, list the options with tradeoffs, and wait. Don't push a growing change through because you're already deep in it.

## Git discipline

- Modify only task files. No repo-wide formatting. Never delete untracked files unless told they're yours to delete — this repo carries local QA artifacts, screenshots, APKs, and reports that must be preserved.
- Before finishing: `git diff --stat` and `git diff --check`.
- If committing: stage only task files, write a concise message, confirm the final tree, and note any unrelated dirty files left untouched.
- Never push. That's a gate.

## Handoff format

Multi-file or risky changes end with:

```markdown
## What changed
- <file/path>: <short description>

## Why it changed
How the change solves the requested problem.

## Verification
- Passed: `<command>`
- Not run: `<command>` because <reason>

## Notes / risks
Owner decisions, gated steps pending (deploys, migrations, builds), feature flags, env var overrides, store implications.

## Git status
- Branch: `<branch>`
- Commit: `<hash or not committed>`
- Unrelated dirty files left untouched: <yes/no, short list if yes>
```

Single-file trivial changes may use one compact line instead: what changed, checks run, branch, and commit.

## Do NOT

- Do not fake test results or claim a deploy, build, or push happened unless the owner ran it and confirmed.
- Do not invent business facts for AI-generated business setup or deal creation.
- Do not create new automatic emails, push notifications, or admin actions without explicit approval.
- Do not expose private customer, owner, billing, or internal admin data in public pages or share links.
- Do not leave vague "should work" language. Give concrete verification or name what's unverified.

## Defaults unless told otherwise

- Main public site: `twoferapp.com`. Share links: `www.twoferapp.com/s/<CODE>`
- Support email: `support@twoferapp.com`
- Trial length: 30 days
- Stripe payment links: admin-approved only
- Initial automatic email: generic trial-request acknowledgement only
- Primary admin customer: business owner. North Star metric: deals redeemed.
- Billing posture: surfaces enabled (`PAID_BILLING_ENABLED = true`), pilot enforcement bypassed (`PILOT_DISABLE_BILLING_GATE = true`). Neither flag changes without approval.
- Keep the current Expo/React Native architecture
- Localization targets: English, Spanish, Korean. The language switcher uses the Mexican flag for Spanish.

## Standing sequencing constraints

Owner-maintained. Check before proposing any gated deploy or build. Delete items only when the owner confirms they've resolved.

- No edge function deploys while an Apple review is active.
- Verify against `docs/release-audit/current-state.md` and recent commits before assuming any listed constraint is still open — items here go stale.

## Final self-check before responding

1. Did I solve the exact request with the smallest correct change?
2. Did I inspect the relevant files before editing and avoid unrelated changes?
3. Did I respect every hard gate and stop condition?
4. Did I preserve Twofer's product invariants and locked decisions?
5. Did I run the gate sequence, or clearly explain what couldn't run?
6. Did I flag migrations, deploys, flags, env overrides, and store implications in the handoff?
7. Could the owner or a less capable model reproduce my verification from the handoff alone?

If any answer is no, fix the gap before finalizing.
