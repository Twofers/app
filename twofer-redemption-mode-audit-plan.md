# Redemption Mode: Audit and Merge Plan

Target: the unaudited work on codex/redemption-mode-staff-sessions (commit 938091d, +3,875 lines). Owner PIN protection and staff-device Redemption Mode. None of it has been reviewed. It touches auth, RLS, five new edge functions, guard edits to 20 existing edge functions, and one migration.

Goal: prove it is safe and that it breaks nothing in the audited batch stack, then merge it into fix/business-locations-keying for the next build. Nothing in this plan pushes, deploys, applies migrations, or builds. The Redemption Mode migration stays unapplied throughout.

Run phases in order. Phase 1 is the merge, because auditing the codex branch in isolation would review code that differs from what ships: the branch was cut at Batch 3 and the stack has moved 11 commits since, with overlapping edits to at least claim-deal, redeem-token, delete-user-account, and the AI functions.

---

## Phase 1: Integration merge on a sacrificial branch (agent, high effort)

```
High effort. Read AGENTS.md first.

Create a new branch audit/redemption-mode-merge from the current HEAD of fix/business-locations-keying. Merge codex/redemption-mode-staff-sessions into it. Do not touch either source branch.

Conflicts are expected in multiple edge functions: the codex branch added staff-session guards to 20 function files at the Batch 3 state, and the stack has since changed claim-deal (Batch 5 notifications), redeem-token (Batch 6 lockout), delete-user-account (Batch 4 purge wiring), ai-generate-deal-copy and ai-generate-ad-variants (Batch 1 limits), and seven demo-stripped functions (Batch 2).

Conflict resolution rule: preserve BOTH sides' intent. Every function keeps its batch-stack behavior AND gains the staff-session guard. If any conflict cannot satisfy both sides, stop and show me the conflict rather than choosing.

After the merge, the full gate suite: npx tsc --noEmit, npm run typecheck:functions (all files), npm test, expo lint, Metro Android export probe. Then a guard-coverage sweep: list every edge function and whether it rejects redeemer staff sessions, including the functions created AFTER the codex branch was cut (the Batch 5/6 changes and anything else new). Staff tokens must not be able to call owner or consumer functions that did not exist when Codex wrote the guards.

Commit the merge locally as "merge: redemption mode into batch stack (audit candidate, not approved)". Do not push. Report: every conflict and how you resolved it, gate results, and the guard-coverage table. Stop.
```

---

## Phase 2: Deep audit, read-only (agent, high effort, output only)

```
High effort. Output only: do not edit any file, do not fix anything you find. You are auditing the merged Redemption Mode code on audit/redemption-mode-merge. Produce a numbered findings report at docs/release-audit/redemption-mode-audit.md (write this one file only, do not commit). Number every finding, assign severity (critical / high / medium / low), cite file and line. Verify every claim against the actual code, not the feature doc.

AREA 1: The auth model. This is the highest-stakes check.
1a. The staff redeemer role rides JWT metadata. Determine exactly which metadata field: user_metadata is CLIENT-EDITABLE via the auth API (any user can set their own user_metadata), app_metadata is server-only. If any guard, RLS policy, or RPC trusts user_metadata for the redeemer role, that is a critical finding: a normal user could self-grant staff status, or a staff token could shed its restriction.
1b. Verify the inverse too: the redeemer rejection guards in owner/consumer functions must key on the same server-controlled field.
1c. How are redeemer Auth users created? Service-role only, or is there any path a client could invoke?

AREA 2: The migration (redemption_devices, redemptions, RLS, staff RPCs). Apply this session's hard-won lessons:
2a. Every column the migration's functions reference must actually exist (the purge_user_data lesson: a function shipped referencing a column no migration created).
2b. EXECUTE grants: Supabase default privileges grant EXECUTE to anon and authenticated on new functions, and REVOKE FROM PUBLIC is insufficient. Check every new function for explicit revokes. Which RPCs can anon call? Which can a normal authenticated consumer call?
2c. SECURITY DEFINER hygiene: SET search_path, minimal privileges, no caller-controlled dynamic SQL.
2d. RLS on both new tables: default-deny, and each policy's USING/WITH CHECK actually scopes to the right principal. Can business A's staff device read or write business B's redemptions?
2e. Does the migration interact with profiles.role (now live in prod via table rebuild)? Do redeemer users get profiles rows, and does anything assume they do or do not?

AREA 3: The five new edge functions (activate, exit, manage-devices, staff-redemption, owner-redemption-security).
3a. Auth on every endpoint: who can call it, verified how, before any work happens.
3b. staff-redemption versus the existing redeem-token flow: does it mark claims redeemed through the same state transition, or a parallel one? Could the same claim be redeemed twice across the two paths? Does staff-redemption respect or bypass the Batch 6 failed_redeem_attempts lockout, and should it have its own?
3c. owner-redemption-security: what hash algorithm for the PIN (must be a real KDF like bcrypt/scrypt/argon2, not plain SHA), salted, timing-safe comparison, server-side attempt throttling on PIN verification, and PIN change requires the current PIN server-side, not just client-side.
3d. Input validation and error responses on all five: no detail leaks, no unhandled paths that 500 with stack traces.

AREA 4: Device and session lifecycle.
4a. Deactivating or removing a device: does it actually revoke the staff user's sessions and refresh tokens (auth admin), or only flag a DB row a live token could ignore?
4b. Deleting the linked staff Auth user: what happens to in-flight tokens, and do FK cascades on redemptions preserve the business's redemption history (the purge lesson again: history must not silently vanish)?
4c. The lost-device path: does the warning's advice (change password, revoke sessions) actually sever a hostile device, walk the token lifetime math.
4d. purge_user_data interaction: if an owner deletes their account, what happens to their redemption_devices rows, the linked staff Auth users, and redemptions history?

AREA 5: The client locked mode.
5a. Can a counter device escape locked mode without the PIN: deep links, the dev menu, notification taps, the share sheet, app-state restoration, killing and relaunching mid-flow?
5b. What persists on the counter device: is anything sensitive (owner tokens, PIN, business PII) in AsyncStorage rather than SecureStore? The locked device must hold NO owner session material by design; verify, do not assume.
5c. The owner PIN gate on the Redeem tab: unlock-once-per-session resets on restart as specified; check it cannot be bypassed by navigation tricks.

AREA 6: Fit with the batch stack (regression risk to existing code).
6a. The 20 guard edits: diff each guarded function against its pre-guard behavior for a NORMAL user. The guards must be pure additions: same inputs, same outputs for non-staff tokens.
6b. Anything Redemption Mode reads that the batch stack changed: deal_claim_counts, claim notification columns, the share tables, profiles.role. List each touchpoint and whether assumptions still hold post-merge.
6c. i18n: every new user-facing string exists in en/es/ko (the Batch 2b lesson: missing es/ko keys ship silent English).
6d. Test adequacy: what the new tests actually cover versus the risk surface above; list the gaps.
6e. redemption-mode-feature.md and the RLS checklist: flag every claim in those docs the code does not back up.

Report format: findings numbered and severity-sorted, then a one-page summary with your overall judgment: merge-ready, merge-ready after fixes, or not close. Stop after writing the report. Do not fix anything.
```

---

## Phase 3: Fix batches (after your review of the report)

You read the report and decide what gets fixed, deferred, or accepted. Then fixes run exactly like the phase-3 batches: smallest change, one commit per batch on audit/redemption-mode-merge, full gates each time, stop after each. Bring the report back to Claude and the batch prompts get written from the actual findings. Any finding rated critical in Area 1 (metadata trust) or Area 3c (PIN hashing) blocks the merge outright until fixed.

---

## Phase 4: Promote the merge (gated, after all fixes pass)

```
All Redemption Mode findings are resolved and I approve the merge. Re-run the full gate suite on audit/redemption-mode-merge: tsc, typecheck:functions, all tests, lint, Metro probe. If green, fast-forward or merge audit/redemption-mode-merge into fix/business-locations-keying with commit message "feat: Redemption Mode and owner PIN (audited)". Do not push. Report the new HEAD and the updated counts of unapplied migrations and undeployed functions, then stop.
```

After Phase 4, the go-live tail mirrors the batch stack's: apply the Redemption Mode migration (with the EXECUTE-revoke check that prod requires), deploy the five new functions plus re-deploy the guard-touched ones, new build, on-device regression including the locked-device escape attempts from Area 5, then the spec section that Batch 8 deliberately skipped.

---

## Standing rules for every phase

No push, no deploy, no migration apply, no build, no version change. The Redemption Mode migration file may be edited by Phase 3 fixes but never applied. Both original branches stay untouched until Phase 4. Stop on anything unexpected.
