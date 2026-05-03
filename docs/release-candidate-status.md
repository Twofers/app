# Release candidate status — TWOFER (pilot gate)

**Date of audit:** 2026-05-03  
**Audience:** Decide whether to run a **5–10 cafe** controlled pilot on **hosted** Supabase and a **production-style** Android build.

This document is a snapshot from the last local audit. Re-run checks after any merge to `main` or change to backend or env.

---

## Readiness level

**Yellow / conditional.** The app codebase is in good shape on paper (typecheck and tests clean; lint has warnings only). **Hosted Supabase, EAS production env, Edge Functions, and real Android devices have not been verified in this audit** — only local tooling was run.

**Repo hygiene:** At audit time, `main` was **not** clean (uncommitted doc and `.env.example` / checklist edits). For a real release candidate, commit or stash everything you intend to ship and tag from a known commit.

---

## What looks ready

- **TypeScript:** `npm run typecheck` passed.
- **Tests:** `npm test` — all **153** tests passed across **21** files.
- **Lint:** `npm run lint` exited successfully; **12 warnings** (unused imports, hook dependency nits). No lint **errors**.
- **Metro:** Expo started on an alternate port (**19007**); bundler reached **“Waiting on http://localhost:19007”**. A Metro disk-cache deserialize warning appeared; it fell back to a full crawl (known environmental class of issue — see `docs/production-deploy-checklist.md` §8).
- **Deploy checklist doc:** `docs/production-deploy-checklist.md` is present and covers migrations, storage, functions, secrets, EAS vars, Android QA, hosted smoke tests, and known risks (see checklist review below).

---

## What was not verified on this machine

- **`npm run typecheck:functions`:** **Not run — Deno is not installed** on the audit environment. If your CI or release machine uses Deno for Edge Function typechecking, run it there or install Deno locally before calling the pilot “fully validated.”
- **Hosted Supabase:** No live project was exercised (migrations, RLS, storage URLs, secrets).
- **EAS production build:** No `eas build` or store-track APK was produced or installed.
- **Physical Android:** No device QA in this pass (only Metro startup).

---

## Checklist doc review (`docs/production-deploy-checklist.md`)

The following pilot-critical areas are explicitly included:

| Topic | Present |
|--------|---------|
| Remote Supabase migration verification | Yes — §1 (including named migrations and Dashboard verification). |
| Storage buckets | Yes — §2 (`deal-photos`, `business-logos`). |
| Edge Functions to deploy | Yes — §3 (core pilot + AI + billing list). |
| Required Supabase secrets | Yes — §4 (names and purposes). |
| EAS / production env vars | Yes — §5. |
| Android real-device QA | Yes — §6 (checklist). |
| Hosted smoke test | Yes — §7 (non-demo / demo / RLS). |
| Known risks | Yes — §8 (Stripe, Places, AI quotas, push/deep links, migrations, Metro cache). |

No gaps were found relative to the audit request. Operators should still execute every checkbox against **their** hosted project.

---

## Required manual checks — hosted Supabase

- Apply and verify **all** migrations in order on the **remote** project; confirm last applied name matches release.
- Confirm **Storage** buckets and policies match migrations; smoke **logo** and **deal photo** upload and public read.
- Set **Edge Function secrets** (`OPENAI_API_KEY`, service role, URL, optional `GOOGLE_PLACES_API_KEY`, production-safe values for menu opt-in flags per checklist).
- Run **RLS / cross-tenant** spot checks from the hosted checklist (consumer cannot write others’ paths; owners cannot read others’ private rows).

---

## Required manual checks — real Android device

Use §6 of `docs/production-deploy-checklist.md` on a **production or internal** build: cold start, business setup + logo, create/ publish path + strong-deal guard, claim/redeem, map key, menu scan error behavior when AI is misconfigured.

---

## Required checks — Edge Functions

- Deploy every function your pilot needs (see checklist §3 — claim/redeem, AI, billing as applicable).
- After deploy, hit **claim**, **redeem**, and **AI** paths once with a **non-demo** account; repeat for **demo** only if demo builds are in scope.
- Confirm **503 / clear errors** when OpenAI or required config is missing (per hosted smoke §7), not silent fallbacks that look like real data.

---

## Go / no-go for a 5–10 cafe pilot

**Recommendation: Conditional GO** for a **controlled** pilot **only after**:

1. Working tree on `main` is **clean** and matches what you will ship (commit docs/env examples if they are part of the RC).
2. **Hosted** Supabase checklist items are executed and signed off (migrations, storage, secrets, RLS).
3. At least one **production-style Android** build passes the §6 device checklist.
4. **`typecheck:functions`** (or equivalent CI) passes where you maintain Edge code — **Deno was missing** on the machine that produced this doc.

**No-go** until those are done, or if any hosted smoke test shows fake data, broken RLS, or silent AI failures for non-demo users.

---

## Release blockers found in automated audit

**None** in app runtime code from typecheck, lint, or tests. This audit did **not** change application source code.
