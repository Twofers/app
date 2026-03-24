# AI ad MVP — manual validation

Lightweight framework to run the **12 cases** from [`../twofer-ai-ad-mvp.md`](../twofer-ai-ad-mvp.md) §3 with **structured scoring**, not gut feel.

## Contents

| File | Purpose |
|------|---------|
| **[SCORECARD.md](./SCORECARD.md)** | Rubric (1–5) + per-case **must-verify** facts |
| **[TEST_CASE_INPUTS.md](./TEST_CASE_INPUTS.md)** | Suggested **offer note**, **price**, **schedule** to paste in the app |
| **[RESULTS_TEMPLATE.md](./RESULTS_TEMPLATE.md)** | Copy for each test session / spreadsheet row |

## How to tag a run in the app

1. Open **Create → AI ad ideas** (`/create/ai`).
2. Expand **Manual QA (validation)**.
3. Enter a tag: **`TC01`** … **`TC12`** (see [TEST_CASE_INPUTS.md](./TEST_CASE_INPUTS.md)).
4. Set offer note, price, schedule, photo → **Generate**.
5. **Supabase function logs** will include `manual_validation_tag` on `generation_ok`, `token_usage`, and errors — correlate with dashboard timestamps.

## Recommended test order

1. **TC01** — baseline (BOGO + narrow time window).
2. **TC03** — combo + **price** in field (checks price + schedule).
3. **TC08** — different structure (buy 2 get 1).
4. **TC10** — **percent** off (checks no invented dollar amounts).
5. **TC02, TC04, TC05** — mix of categories.
6. Remaining cases in any order.

**Profile A/B (after baseline):** Run **TC01** twice: (A) empty Account profile, (B) profile filled with **wrong** category vs note (e.g. profile “bakery”, offer lattes). **Offer facts must still win.**

## Limits

- **No automated pass/fail** — human scores only.
- **Logs** identify tag + user + regen attempt; they do **not** store ad text (privacy / size). Paste headlines into `RESULTS_TEMPLATE.md` yourself.
- **Regen cap** (2) still applies; use **Generate** again for a fresh batch if needed.
