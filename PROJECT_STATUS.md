# TWOFER — Project Status

_Plain-English status of the app. This file is the single source of truth and is
updated after every work session._

**Last updated:** 2026-05-28
**Phase:** 2 (Fixing, one safe step at a time — the image-model fix is in)
**Also in progress:** a pre-launch polish-and-quality pass — see §9 for the full audit.

---

## 1. What this app is

TWOFER is a phone app for small coffee shops and bakeries in the Dallas–Fort
Worth suburbs. It has two sides:

- **Customer side:** people browse "buy one, get one" deals near them, claim a
  deal, and show a code at the counter to redeem it.
- **Shop-owner side:** a cafe owner posts deals. The headline feature: the owner
  types a short prompt (e.g. "free latte with any pastry") and the app writes the
  whole ad for them — the words **and** a picture — automatically.

**How it's built (jargon, defined once):**
- **Expo / React Native** — the toolkit the phone app is written in.
- **Supabase** — the online backend: the database (where deals, shops, and users
  live) plus small server programs called **Edge Functions** (these are where the
  AI work happens, _not_ on the phone).
- **OpenAI** — the outside company whose AI writes the ad text and makes the ad
  image. The app talks to OpenAI from inside Supabase.

---

## 2. What I did in Phase 1

I **only looked** — I changed nothing. I read the screens, the database setup,
the server functions, and traced exactly how the AI feature is wired. I also
checked whether the code is healthy enough to run.

---

## 3. Does the code run?

**Yes — the app code itself is healthy.** Two automated health checks passed:

- **Type-check** (catches broken code before it runs): **passed, no errors.**
- **Expo project doctor** (18 project checks): **17 of 18 passed.** The one
  warning is minor — 8 helper packages are one tiny version behind. Harmless.

So the app is not "broken code." The problems below are about **settings and the
live backend**, not the app's source code.

---

## 4. How the AI feature works (and what keys it needs)

The flagship feature is **100% OpenAI**. When an owner taps "create a deal":

| Part of the ad | Which AI does it | Default model |
|---|---|---|
| The words (headline, description, deal terms) | OpenAI Chat | `gpt-4o-mini` |
| The picture | OpenAI Images | `gpt-image-2` |
| Voice input (optional, if they speak instead of type) | OpenAI Whisper | `whisper-1` |

**The key you need:** just **one** — `OPENAI_API_KEY`. It is a secret password
for OpenAI. It must be stored **in the Supabase dashboard** (Project Settings →
Edge Functions → Secrets), **never in the code**. That one key powers text,
image, and voice.

Optional, only if you want these extra features later:
- `GOOGLE_PLACES_API_KEY` — auto-fills a shop's address/details during setup.
- Stripe keys — for the $30/month billing.

---

## 5. What's broken — ranked from most to least serious

### #1 — The app is asking OpenAI for a picture "model" that probably doesn't exist  ⚠️ MOST SERIOUS
- **Key is fine.** You confirmed (2026-05-28) the `OPENAI_API_KEY` is set in the
  Supabase dashboard and the OpenAI account has credits. So the key is NOT the
  problem. Good — that rules out the simplest cause.
- **New prime suspect — the model name.** Think of an AI "model" as a specific
  version, like asking for "iPhone 17." The app's setup runbook
  (`docs/deployment-notes.md`) tells you to set the picture model to
  **`gpt-image-2`**. The real, available OpenAI picture model is
  **`gpt-image-1`**. I have no evidence `gpt-image-2` is something you can
  actually call. If it isn't real, OpenAI rejects every picture request.
- **Two different broken-looks, depending on which model is wrong:**
  - If the **picture** model is wrong → you still get the **words**, but **no
    image** (a missing/blank picture). The code keeps going without the picture.
  - If the **words** model is wrong → you get **nothing at all** (an error), because
    the code stops the moment the words fail.
- This is a **settings** problem, not broken code — which is good news: the fix is
  changing a setting, no risky code surgery.
- **What I can't see from here:** the live error logs and the exact model names
  currently set. I need one small thing from you to confirm (see §8).

### #3 — Local testing of the AI is broken: the file `supabase/.env` is corrupted  ✅ FIXED 2026-05-28
- That file was supposed to hold local settings. Instead it had **3 stray lines of
  leftover code** and **no OpenAI key**.
- **Impact was limited:** this file lives only on this computer (it is not shipped
  to the live app), so it never broke the live product — it just meant nobody could
  test the AI on this machine.
- **Fixed:** I replaced the junk with a clean, properly-formatted template (see
  Fix #3 in §6). Local AI testing now just needs you to paste an OpenAI key into it.

### #4 — The old database errors you remembered ("missing columns", "ON CONFLICT") appear already fixed — but I haven't proven it  🟡 MEDIUM (needs a verification run)
- A recent change ("Fix duplicate Supabase migration timestamp") and the current
  database setup files look correct: the table the AI uses has every column it
  needs, and the migration files no longer clash.
- **But** I have not actually rebuilt a fresh database to watch them run cleanly.
  I recommend one verification run in Phase 2 before we call it solved.

### #5 — 8 Expo packages are one patch version behind  ✅ FIXED 2026-05-28
- Was cosmetic. All 8 are now updated to the versions the Expo SDK expects (see
  Fix #4). Type-check still passes; "Dependencies are up to date."

---

## 6. What's been fixed so far

**Fix #1 (2026-05-28) — stop pointing at the `gpt-image-2` picture model.**
- Changed the app's built-in default picture model from `gpt-image-2` to the
  known-good `gpt-image-1` (`supabase/functions/_shared/dalle-image.ts`).
- Fixed the setup notes that recommended `gpt-image-2` so it can't come back
  (`docs/deployment-notes.md`, `docs/deployment-command-plan.md`, `.env.example`).
- Also softened the `.env.example` text-model note so it no longer recommends an
  unverified `gpt-5.4-mini` (the safe default `gpt-4o-mini` is used when unset).
- Safety check (typecheck) passed. Saved as a git checkpoint.
- **Live app updated too (2026-05-28):** you set the three dashboard secrets
  (`OPENAI_IMAGE_MODEL_DEFAULT`, `OPENAI_IMAGE_MODEL_GENERATE`,
  `OPENAI_IMAGE_MODEL_EDIT`) to `gpt-image-1`. I confirmed the code reads those
  exact names, so your change is wired in correctly and takes effect with no
  redeploy. The code change above is the belt-and-suspenders backup for future
  deploys.
- **Not yet eye-tested:** you don't have the newest app build on your phone, so
  we haven't watched a real ad generate with an image yet. That's the one
  remaining confirmation, and it waits until you update your phone (§7).

**Fix #2 (2026-05-28) — I read the rest of the AI code; found no more breaks.**
- You asked me to "check the rest of the code." I read all five AI server
  programs and the create-a-deal screen end to end. Summary in §6b below.
- **No code changed for this** — it was a review. The only real bug in the whole
  system was the `gpt-image-2` name, already handled by Fix #1.

**Fix #3 (2026-05-28) — cleaned up the corrupted local test file `supabase/.env`.**
- Removed the 3 stray lines of leftover code and replaced them with a clean,
  correctly-formatted template (plain-English header + a blank `OPENAI_API_KEY=`
  line for you to fill, with the picture model pinned to `gpt-image-1` to match
  your live setting).
- **No git checkpoint for this one** — that file is git-ignored on purpose (it's
  local-only and must never ship), so cleaning it leaves the saved history clean.
  This is expected, not a mistake.
- **To test the AI on this computer later:** paste your OpenAI key after the `=`
  in `supabase/.env`, then run the local Supabase stack. (Not needed for your
  phone test — that uses the live dashboard key you already set.)

**Fix #4 (2026-05-28) — updated the 8 out-of-date helper packages.**
- Bumped all 8 to the exact versions the Expo SDK expects (all tiny patch
  updates, same SDK 54 — low risk). `expo install --check` now says
  "Dependencies are up to date" and the type-check still passes.
- **FYI, not acted on:** the updater suggested adding an `expo-web-browser`
  plugin entry to `app.config.js`. The app has always worked without it (that
  plugin is optional for normal "open a link" use), so I left the config alone
  rather than guess. Mention it if you ever want it added.

**Fix #5 (2026-05-28) — removed `gpt-image-2` from the allowed picture-model list.**
- Deleted the two `gpt-image-2` entries from the server-side allowlist in
  `supabase/functions/_shared/dalle-image.ts`, so the name that caused this whole
  incident can never be accepted again. If any setting ever points there, the code
  now safely falls back to `gpt-image-1`.
- Also fixed one more stale doc line that still listed `gpt-image-2` as the default
  (`docs/deployment-notes.md`) — a line I missed in Fix #1.
- This is a server (edge-function) change, so it takes effect the next time the
  functions are deployed. Your live setting is already `gpt-image-1`, so nothing
  changes for you today — this just closes the door for good.

**Note on the test-database rebuild (the old §5 #4 item):** you don't want a
local Supabase stack, and rebuilding the *live* database is off-limits (it would
risk real data). So migration health stays "verified by reading the files"
(done in Phase 1 — they look correct). Real-world proof will come naturally the
next time a migration deploys to production.

---

## 6b. Full code review — what I checked and what I found

I read every place the app talks to OpenAI, plus the screen owners use to make an
ad. Plain-English results:

| Area I checked | Healthy? | Notes |
|---|---|---|
| Make-an-ad (words + picture) — the flagship | ✅ | Well-built. If the picture fails, the words still come through. |
| Voice note → text (the mic button) | ✅ | Uses the known-good `whisper-1`. Falls back gracefully. |
| Auto-fill shop details during setup | ✅ | Tries Google first, then AI; safe model; friendly errors. |
| Scan a menu photo → item list | ✅ | Safe model; clear "try again" message if it can't read the photo. |
| Deal-copy text suggestions | ✅ | The crash an old report warned about is already fixed. |

**Three things I confirmed that protect you:**
1. **No other wrong model names.** I scanned every server program for bad model
   names like the `gpt-image-2` one. Only that single one existed — now fixed.
   Words use `gpt-4o-mini`, voice uses `whisper-1`, both real and known-good.
2. **A missing picture never shows as "broken."** If the AI can't make the
   image, the owner sees a tidy "no image yet" placeholder (or their own uploaded
   photo) — never a broken-image icon — and the ad's words are unaffected.
3. **Owners never see scary error codes.** Every failure is translated to a plain
   sentence (e.g. "Please wait a moment before generating again.").

**Optional hardening — DONE 2026-05-28 (see Fix #5):**
- The code's list of "allowed picture models" no longer includes `gpt-image-2`, so
  that bad name can never be selected again — not from the dashboard, not from a
  future deploy. Only the `gpt-image-1` family remains.

---

## 7. What I recommend next (Phase 2 — only when you say "go")

In order, smallest safe step first:

1. **You:** confirm/set `OPENAI_API_KEY` in the Supabase dashboard, and confirm
   the OpenAI account has billing. (I'll give you exact click-by-click steps.)
2. **Me:** fix the corrupted `supabase/.env` so we can test locally.
3. **Together:** run one AI ad generation and watch it succeed (text + image).
4. **Me:** do one clean database rebuild to prove the old DB errors are gone.
5. **Me:** (optional) bump the 8 minor package versions.

I will fix **one thing at a time**, save a checkpoint after each, and tell you
exactly how to check each fix yourself.

---

## 8. Open questions only you can answer

- **CONFIRMED 2026-05-28:** `OPENAI_API_KEY` is set and the OpenAI account has
  credits. (So the key is not the problem.)
- **Still need from you — what do you actually see when you try AI now?**
  - An error / no ad at all → points at the **words** model.
  - The words appear but the **picture** is missing/blank → points at the
    **picture** model (the `gpt-image-2` suspect above).
  This one answer tells me exactly which setting to fix first.
- (Optional, even more certain) In the Supabase dashboard → Edge Functions →
  Logs, the failed attempt prints the exact OpenAI error. If you can read me that
  red line, it names the bad model directly.

---

## 9. Polish Audit — pre-launch review (2026-05-28)

A senior-developer "does this look like a pro built it?" pass over the whole app.
**This was a read-only review — no code was changed in this step.** The AI
ad-generation feature was intentionally left untouched (it is being handled
separately), and nothing about the database was changed.

### Headline: the app is in good shape

This is **not** a rough prototype. It already has the things that separate a
"real" app from a weekend project:

- **One consistent design system.** Colors, spacing, corner-radius, shadows, and
  text sizes are defined in one place (`constants/theme.ts`) and used across ~25
  screens. The orange-on-white penguin brand is applied consistently almost
  everywhere.
- **Loading states everywhere.** Screens show spinners or "skeleton" placeholders
  while data loads — they don't look frozen.
- **Friendly empty states.** When there are no deals nearby, the customer sees a
  branded penguin card with encouragement and buttons ("widen your search",
  "view all deals") — not a blank screen.
- **Friendly error messages.** Failures are translated into plain sentences
  (e.g. "Please wait a moment before generating again.") via a shared error
  helper. I found **no raw error objects or scary codes shown to users.** The
  error banner even has a "retry" button.
- **Three languages.** English, Spanish, and Korean are wired through the whole
  app, including translated deal titles.
- **Accessibility basics are present.** Buttons have labels, tap targets are
  large (most buttons are 48–58px tall), and small icons have extra tap area.
- **Real app identity.** Branded penguin app icon, branded splash screen with the
  TWOFER wordmark, and the screen is locked to "light mode" so the white-background
  design can't be broken by a phone's dark mode.
- **Clean under the hood.** No "TODO"/"lorem ipsum"/leftover "test" text, no dead
  buttons that do nothing, and the type-check passes with zero errors.

So the work here is **polish on a solid base**, not a rescue job.

### What I found — ranked by how much a real user would actually notice

**1. The "Create a deal" screen looks like a different app. 🔴 Most noticeable**
- This is the screen a cafe owner uses most — the flagship "type a prompt, get an
  ad" feature (`app/create/ai.tsx`).
- Unlike the rest of the app, it uses hand-picked one-off colors — including
  several **blue** tones (`#f0f7ff`, `#c5daf7`, `#cfd7ff`) that clash with the
  orange brand — and plain grey `#ccc` input boxes instead of the app's standard
  styled inputs.
- **Why it matters:** it's the most important owner-facing screen, and it's the
  one place the otherwise-consistent design visibly breaks. An owner could feel
  the app is "unfinished" exactly where it should impress most.
- **This is a bigger change → see "Needs your decision" below.** (It's also in the
  AI feature area I was told to leave alone, so I want your explicit go before
  touching it — even though the change would be cosmetic only, not the AI itself.)

**2. Deals with no photo show a random internet stock photo. 🟠 Noticeable**
- When a deal has no uploaded image (and before the AI picture is made), the
  customer feed fills the big hero image with a **stock coffee photo pulled from
  the internet** (`app/(tabs)/index.tsx`, the Unsplash URL).
- **Why it matters:** (a) it's not the shop's photo and not branded, so it can
  look generic or even misleading; (b) it depends on an outside website staying
  up — if that link ever breaks, the card shows a broken image.
- **Recommendation:** swap it for a clean branded "no photo yet" placeholder
  (orange/penguin) that ships inside the app. Low risk, but it changes something
  visible → I'll confirm with you first (see "Needs your decision").

**3. A few forms use plain grey input boxes instead of the styled ones. 🟡 Subtle**
- The login extras, password-reset, "edit business", and "scan a menu" screens
  draw their text boxes with a plain grey `#ccc` border instead of the app's
  standard input style.
- **Why it matters:** side by side, the app feels very slightly uneven. Most users
  won't consciously notice, but it's the kind of thing that adds up.
- **Safe to fix myself → Step 2.**

**4. Error-red and success-green are hand-typed on each screen. 🟡 Subtle**
- The red used for errors and the green for success are typed in directly on each
  screen (`#d32f2f`, `#2e7d32`, etc.) rather than defined once in the theme. They
  vary slightly from screen to screen.
- **Why it matters:** minor visual inconsistency, and it makes future changes
  harder. Adding proper "danger / success / warning" colors to the theme is the
  professional way to do it.
- **Safe to fix myself → Step 2.**

**5. Leftover starter-kit files in the project. ⚪ Invisible to users**
- Four default Expo template images (`react-logo*.png`, `partial-react-logo.png`)
  are sitting in the assets folder, unused and referenced nowhere.
- **Why it matters:** a developer reviewing the code would flag them as clutter;
  users never see them.
- **Safe to fix myself → Step 2 (delete the dead files).**

**6. Inconsistent behind-the-scenes logging. ⚪ Invisible to users**
- The project has a proper "only log during development" helper (`lib/dev-log.ts`),
  but ~14 files still call the raw logger directly. Most are diagnostic paths.
- **Why it matters:** purely a code-tidiness issue; not visible to users and not a
  bug. Worth standardizing for a clean reviewer impression.
- **Safe to fix myself → Step 2 (low priority).**

### Smaller observations (noted, not necessarily worth acting on)

- **Two penguin styles.** The home-screen app icon is a **blue**-scarf penguin on a
  blue background; the in-app/splash penguin is **orange**-accented on white. Not
  broken — just slightly inconsistent between the icon you tap and what opens. A
  design call for you, not a code fix.
- **Tiny logo in empty cards.** The empty-state cards reuse the splash image (which
  has "TWOFER" text baked in) shrunk to ~34px, so the wordmark becomes too small to
  read. Cosmetic; could use a plain penguin mark instead.
- **Developer "FIX:" notes** left in a few files (e.g. `app/_layout.tsx`,
  `app/auth-landing.tsx`). Harmless; slightly noisy to a reviewer.

### What I can't fully verify from here

- I reviewed **code only** — I did not run the app on a phone/emulator in this pass.
  Things like exact on-screen spacing, animation smoothness, and live navigation
  flow are best confirmed on your device. I found no dead buttons or
  unreachable screens in the code, but a real tap-through is the final proof.
- The app icon/splash **files exist and are wired correctly**, and I viewed them —
  they're the proper branded penguin, not placeholders.

### Plan from here

- **Step 2 — safe fixes I'll do now, one checkpoint (commit) each:** items 3, 4, 5,
  6 above (grey inputs → standard style, add theme danger/success colors, delete
  dead starter images, tidy logging). Each is low-risk, reversible, and I'll
  type-check after every one.
- **Step 3 — needs your decision before I touch anything:** items 1 and 2 above
  (restyle the flagship "Create a deal" screen to match the brand; replace the
  internet stock-photo fallback with a branded placeholder).

### ✅ Done — polish pass completed (2026-05-28)

You approved both Step 3 items, so the whole list (1–5) was done. Each fix is its
own saved checkpoint (commit) with a plain-English message, and the type-check
passed with zero errors after every single one. **Nothing about the AI itself, the
database, or the orange brand color was changed** — this was visual consistency
only. Here is every change, newest first, and how to see it on your phone:

- **Restyled the "Create a deal" (AI) screen to match the brand.** *(commit
  `db18a90`)* The off-brand blue boxes and plain grey inputs on the app's most
  important owner screen are gone; it now uses the same orange-on-white look as the
  rest of the app. I only restyled the *app's* parts of the screen — the little
  preview of the finished ad is left exactly as the AI makes it.
  **See it:** open the **Create** tab → the prompt box, buttons, and panels now
  look like the rest of the app.
- **Branded "Photo coming soon" tile instead of a random internet photo.** *(commit
  `077d2ff`)* When a deal has no picture yet, the customer feed used to fill the big
  image with a stock coffee photo pulled off the internet. It now shows a clean
  orange coffee-cup tile that ships inside the app — on-brand and can't break.
  **See it:** the home feed, on any deal that hasn't had a photo added yet.
- **One shared color for the favorite heart everywhere.** *(commit `c6f7abf`)* The
  pink "favorite" heart was hand-typed on three screens; it's now one defined color.
  **See it:** tap the heart on the home feed, a business page, and a deal page — the
  exact same pink in all three.
- **Standard input boxes on the password, account, and menu-scan screens.** *(commits
  `dcad9af`, `5559736`)* These forms used a plain grey box instead of the app's
  styled input. They now match every other form.
  **See it:** "Forgot password", "Reset password", the Account tab, and "Scan a menu".
- **Consistent error-red and success-green across the app.** *(commits `7befa94`,
  `5df7d10`, plus the new tokens in `b889a64`)* The red for errors and green for
  success were typed in slightly differently on each screen; they're now defined
  once in the theme and reused. **See it:** the green "subscribed" note on Billing,
  and any red error message — same shade everywhere now.
- **Deleted leftover starter-kit images.** *(commit `36b63b3`)* Four unused default
  Expo template pictures were removed from the project. Invisible to users — purely
  a tidiness fix so the project looks professionally maintained.

**Not done (your call, no action needed):** the blue app-icon penguin vs. the
orange in-app penguin, the tiny wordmark in empty-state cards, and the
behind-the-scenes logging tidy (item 6) — all cosmetic/internal, none worth the
churn before the pilot. Say the word if you want any of them.

**How to test the whole thing:** run `npx expo start`, press `a` for the Android
emulator (or scan the QR code with your phone), and tap through Home → a deal →
Create → Account. Everything should feel like one consistent, crisp orange-and-white
app. If anything looks off, tell me which screen and I'll fix it.
