# AI generate cooldown: live countdown + auto-dismiss — implementation plan

Status: PLAN ONLY (not implemented). Written 2026-07-09 from a read-only audit.
Requested by Dan: "it says please wait 15 seconds but never changes — make it an
actual countdown and have it go away when the cooldown is over."

## What happens today (root cause)

1. `ai-generate-ad-variants` enforces a server cooldown (default 60s,
   `AI_COOLDOWN_SECONDS`, see `supabase/functions/_shared/ai-limits.ts:4`).
   On a too-soon retry it returns HTTP 429 with
   `{ error: "Please wait Ns before generating again.", error_code: "COOLDOWN_ACTIVE", wait_seconds: N }`
   (`supabase/functions/ai-generate-ad-variants/index.ts:3618-3627`).
2. The client transport keeps only `message` + `code`; **`wait_seconds` is
   dropped** (`lib/functions.ts` → `readInvokeErrorBody` :844-863, `invokeAdEdge` :865-883).
3. On the AI create screen, `friendlyGenerationError` returns the **raw English
   server string** for `COOLDOWN_ACTIVE` (`app/create/ai.tsx:2612`). The
   `generateAd` catch (:2868-2886) stores it once via
   `setGenerationFailureState`, which renders it as the static title of the
   generation-recovery card (:5236-5262) plus an error banner. Nothing ever
   ticks or clears it, so "Please wait 5s" sits on screen forever.
4. `classifyGenerationFailure` lumps `COOLDOWN_ACTIVE` with `MONTHLY_LIMIT`
   into `quota_or_cooldown_blocked` (`lib/create-ai-generation-outcome.ts:36-38`),
   so the card body says "AI generation is paused for this account right now…"
   — scary and wrong for a 15–60 second pace limit.
5. The `reviseAd` catch (:3060-3065) shows the same stale string as a banner.

Bonus bugs fixed by this plan: the raw server message is English-only (es/ko
users see untranslated text), and the "paused for this account" body is
misleading for a short cooldown.

## Target UX (chosen design)

Do **not** make the big recovery card count down. For a 15–60s pace limit a
card with "Edit details" recovery actions is overkill, and auto-removing a
paragraph mid-read is jarring. Instead use the pattern the app already ships on
the auth screen ("Resend in {{seconds}}s", `app/auth-landing.tsx:243-257,546`):

- On `COOLDOWN_ACTIVE`: **no error card, no error banner.**
- The **Generate ad button itself becomes the countdown**: disabled, label
  `Try again in {{seconds}}s`, updating every second.
- One small muted caption near the button (same style as the quota caption at
  `app/create/ai.tsx:5207-5211`): "Short pause between AI generations."
- At 0 the button flips back to "Generate ad" and the caption disappears —
  the UI "goes away" by construction, nothing to dismiss.
- While the cooldown is active the revise/refine submit CTA is also disabled
  (the server applies the same cooldown to revisions).
- `MONTHLY_LIMIT` / `REVISION_LIMIT` keep the existing recovery card — those
  genuinely stop AI for a while and deserve the "write it yourself" guidance.

This matches Dan's minimal-copy preference: the only new copy is one short
button label and one caption line.

## Hard gate — AI core lock (do this FIRST)

`app/create/ai.tsx` and `lib/functions.ts` are hash-locked in
`docs/ai-poster-core-lock.json` (:23, :100); `lib/ai-poster-core-lock.test.ts`
fails if they change without a lock update. Before editing, present to Dan and
get explicit per-file approval:

| File | Intended change | Validation impact | Deploy impact |
|---|---|---|---|
| `app/create/ai.tsx` | Cooldown countdown state + button label; skip error card/banner for COOLDOWN_ACTIVE only. No generation, prompt, poster, or publish logic touched. | baseline gates + manual QA | app rebuild only |
| `lib/functions.ts` | Thread `wait_seconds` from the 429 body onto the thrown error. No payload/request changes. | baseline gates | none (client only) |

After the approved edits, update both files' `sha256` + `approvalRef` +
`rationale` in `docs/ai-poster-core-lock.json`.

No edge-function changes are needed — `wait_seconds` is already returned by
the deployed function (redeployed 2026-07-09), so there is nothing to deploy.

## Implementation steps

### 1. `lib/functions.ts` — carry `wait_seconds` (locked file)

- Extend `ErrorWithCode` (:139) with `waitSeconds?: number`.
- `readInvokeErrorBody` (:844): also read `wait_seconds` when it is a finite
  number and return it.
- `throwInvokeError` (:169): optional third param `waitSeconds?: number`,
  attached to the thrown error.
- `invokeAdEdge` (:865): pass `fromBody.waitSeconds` through.
- New export `getErrorWaitSeconds(e: unknown): number | undefined` next to
  `getErrorCode` (:161). Fallback chain: `err.waitSeconds` → parse `/(\d+)\s*s/`
  from the message → `undefined` (caller defaults to 60, mirroring
  `DEFAULT_COOLDOWN_SEC`).

### 2. `lib/create-ai-generation-outcome.ts` — split the outcome kind (not locked)

- Add `"cooldown_blocked"` to `GenerationOutcomeKind`.
- `classifyGenerationFailure`: `COOLDOWN_ACTIVE` → `cooldown_blocked`;
  `MONTHLY_LIMIT` / `REVISION_LIMIT` stay `quota_or_cooldown_blocked`.
- `canUseFallbackTemplateForOutcome` unchanged (cooldown returns false).
- Update `lib/create-ai-generation-outcome.test.ts` for the new kind.

### 3. `app/create/ai.tsx` — countdown state machine (locked file)

- New state: `const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)`
  — an **epoch-ms deadline**, not a decrementing counter, so it stays correct
  if the app backgrounds mid-countdown.
- Ticker effect active only while `cooldownUntil != null`, re-rendering once a
  second (the `setTimeout` chain pattern from `app/auth-landing.tsx:253-257`).
  Derive `cooldownSecondsLeft = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))`;
  when it reaches 0, `setCooldownUntil(null)` and call
  `clearGenerationErrorState()` defensively.
- `generateAd` catch (:2868): when `code === "COOLDOWN_ACTIVE"`, set
  `cooldownUntil = Date.now() + (getErrorWaitSeconds(err) ?? 60) * 1000`,
  keep the `GENERATION_FAILED` trackEvent, and **skip** both
  `setGenerationFailureState` and the error `setBanner`. All other codes:
  unchanged.
- `reviseAd` catch (:3060): same `COOLDOWN_ACTIVE` branch (set deadline, skip
  the error banner, keep `REVISION_FAILED` tracking).
- Generate button block (:5212-5224): when cooldown is active render a
  disabled `PrimaryButton` titled
  `t("createAi.generateCooldownCta", { seconds: cooldownSecondsLeft })`;
  add a top-of-`generateAd` no-op guard for the active cooldown. Disable the
  revise submit CTA while active too.
- Caption while active, styled like the quota line (:5208):
  `t("createAi.cooldownCaption")`.
- `friendlyGenerationError` (:2612): the COOLDOWN_ACTIVE branch is now
  unreachable from the two catch paths; change it to return a localized string
  (`t("createAi.cooldownCaption")`) instead of `raw` so no residual path can
  ever show unlocalized server text.
- Leave the voice-note transcribe cooldown (:2491, `transcribeCooldown`)
  as-is — it already shows a friendly static message; out of scope.

### 4. Localization — `lib/i18n/locales/{en,es,ko}.json` under `createAi`

Two new keys (base files only — do NOT add to
`es.createAi.overrides.json` / `ko.createAi.overrides.json`; overrides layer on
top per `lib/i18n/config.ts:6-13`, and a stale override would shadow the base):

- `generateCooldownCta`: en "Try again in {{seconds}}s" ·
  es "Reintenta en {{seconds}}s" · ko "{{seconds}}초 후 다시 시도"
- `cooldownCaption`: en "Short pause between AI generations." ·
  es "Pausa breve entre generaciones con IA." ·
  ko "AI 생성 사이 잠시 기다려 주세요."

(Existing `aiCompose.cooldownGenerate` and `consumerDealDetail.cooldownBanner`
belong to other namespaces — do not reuse.)

### 5. Validation

- `npm run typecheck`, `npm run lint`, `npm test` (includes the updated
  outcome test and the lock test, which forces step 6).
- `lib/create-ai-ux-source.test.ts` currently has **no** cooldown assertions
  (verified) — do not touch it unless adding a guard, and it is lock-listed.
- Manual QA on the dev APK: generate, immediately generate again → button
  reads "Try again in Ns" and counts down → at 0 the button and caption revert
  with no leftover card/banner; repeat once in es or ko to confirm localized
  copy; confirm the monthly-cap path still shows the recovery card.

### 6. Lock bookkeeping

Update `docs/ai-poster-core-lock.json` entries for `app/create/ai.tsx` and
`lib/functions.ts` (new sha256, approvalRef "2026-07-09 Dan chat approval:
cooldown countdown", rationale sentence describing the change).

## Edge cases covered

- `wait_seconds` absent (older function build): regex fallback on the message,
  then 60s default.
- App backgrounded mid-countdown: deadline math self-corrects on resume.
- Countdown ending early vs. server clock: server recomputes on every request;
  if a tap at 0 still hits the cooldown, the client just restarts the countdown
  with the fresh `wait_seconds`.
- Monthly cap and revision cap behavior is intentionally unchanged.

Estimated size: ~120–150 lines across 4 source files + 2 test files + 3 locale
files. Client-only; needs an app rebuild to see on device.
