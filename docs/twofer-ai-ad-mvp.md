# Twofer AI Ad Feature — MVP program brief

Canonical reference for definition of done, test cases, guardrails, and metrics.  
Implementation lives in `app/create/ai.tsx`, `lib/ad-variants.ts`, `supabase/functions/ai-generate-ad-variants/`.

---

## 1. Definition of done

**Done** when a business owner can: upload one image → type one short offer → generate → get **3 clearly different** ads (value / neighborhood / premium) → choose one → edit if needed → save to draft / publish.

### MVP acceptance criteria (checklist)

- [ ] One image upload; one plain-language offer prompt.
- [ ] Exactly **3** options returned, each with: headline, subheadline, CTA, **creative lane**, rationale, optional visual direction.
- [ ] Copy matches **actual offer** (item, discount, price, **time window** when set in the flow).
- [ ] At least **2 of 3** feel clearly different on first read (differentiation test).
- [ ] Owner can edit: headline, subheadline, CTA, offer details, **time window** (scheduling UI).
- [ ] Owner selects one ad → loads into draft; can publish or save template.
- [ ] Visible loading state; **manual fallback** if AI fails.
- [ ] No voice, no profile autofill, no AI images required for MVP.

### Non-goals (v1)

Voice, autonomous agents, AI-generated images, full profile scraping, dashboard insights, multi-image, unlimited regeneration, background auto-retries.

---

## 2. What “different” means (3 lanes)

| Lane | Job | Should sound like |
|------|-----|-------------------|
| **Value** | Deal is obvious | Direct, savings, practical |
| **Neighborhood** | Feels local & human | Warm, routine, community |
| **Premium** | Product worth trying | Craft, freshness, quality — not pretentious |

**Differentiation test:** On one read, someone can name which card is “deal,” which is “local,” which is “quality.”

---

## 3. Real test set (12 cases)

**Structured validation:** [`ai-ad-validation/`](./ai-ad-validation/README.md) — scorecard, results template, suggested inputs, log tagging.

Use as QA rows in a spreadsheet; judge **correctness** (BOGO, times, price, item) + **lane feel** + **Twofer voice** (plain, local, not Groupon-y).

1. **Coffee / latte BOGO** — 2–4 PM today; two lattes photo.  
2. **Bakery muffins** — half off after 2 PM; muffin tray.  
3. **Pizza lunch** — 2 slices + drink $8, 11–2; slice + drink.  
4. **Smoothie BOGO** — 3–5 PM; bright cups.  
5. **Donut dozen** — $10 mixed after 5; box photo.  
6. **Sandwich combo** — free drink with full sandwich 1–3; sandwich + drink.  
7. **Ice cream** — 2nd scoop half off 2–4; two cups.  
8. **Tacos** — buy 2 get 1 free 2–5; plated tacos.  
9. **Boba** — free topping large drink 12–3; colorful drinks.  
10. **Deli salads** — 25% off prepared salads after 4; case photo.  
11. **Juice bar** — 2nd half off 1–3; bottles.  
12. **Bagel** — free coffee with bagel sandwich after 10; sandwich + coffee.

---

## 4. Business profile

**Shipped (optional, nullable):** `businesses.category`, `tone`, `location`, `short_description` — edited under **Account → Business profile**. Passed to AI as `business_context` when non-empty. **Never required** for deals or AI.

**Later:** hours, logo, picklists, colors, banned words, etc. See `docs/PRODUCT_DECISIONS_AI_ADS.md`.

---

## 5. Cost guardrails

| Rule | Target |
|------|--------|
| Ads per request | Exactly 3 |
| Inputs | Typed + 1 image |
| Concurrent generations | One at a time (UI disabled while loading) |
| Free-tier regenerations | **Max 2** per draft (enforced client + server) |
| Model | `gpt-4o-mini` default; `OPENAI_AD_MODEL` override |
| Logging | Token usage logged per request (function logs) |

---

## 6. Editing (owner must not be trapped)

Always editable: headline, subheadline, CTA, offer details, schedule.  
AI speeds creation; **manual path always available.**

---

## 7. Moderation & voice (prompt + review)

- Offer accuracy vs owner note + schedule.  
- No fake scarcity, false price, invented “today only” without note.  
- No health claims, “best in town,” mass-coupon tone.  
- Plain, local, short sentences — see §9 in original brief.

---

## 8. Success metrics (instrumentation)

Track: generate tapped, success/fail, regenerate, ad selected (by lane), edits before publish, publish with AI draft, regeneration loops.  
**Client:** `lib/analytics.ts` (`__DEV__` + optional sink).  
**Server:** `tag: "ai_ads"` JSON logs.

---

## 9. Fallback copy (product standard)

> We couldn’t generate ads right now. You can still finish this offer manually.

Keep image + offer note; show title / subheadline / CTA / details fields; save without AI.

---

## 10. One-page success / failure

**Succeeds if:** E2E works, 3 lanes distinct, copy matches offer, light edits, fast enough, never blocks manual create.

**Pause and fix if:** three similar ads, wrong offer facts, endless regenerate, heavy rewrites, spammy voice, slower than typing.

---

## Recommended next actions

1. Run the 12 test cases after each prompt/model change.  
2. Score with acceptance checklist, not “sounds smart.”  
3. Add voice / profile / image gen only after MVP bar is met.
