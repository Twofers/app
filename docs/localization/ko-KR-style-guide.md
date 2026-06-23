# Twofer ko-KR Style Guide

Status: pending native reviewer.

Current ownership:

- Internal localization owner: Dan / Twofer admin
- Korean reviewer: TBD before production launch

## Exact Offer Mechanics

- Render exact mechanics from structured facts. Do not translate a completed English offer sentence.
- Do not infer Korean counters at runtime.
- Until counters and particles are reviewed, use counter-free fallback templates:
  - "구매 항목: {paidItem} × {paidQuantity}"
  - "추가 혜택: {rewardItem} × {rewardQuantity}"
  - "할인 항목: {item} × {quantity}"
  - "혜택: {discountPercent}% 할인"
- Business names and branded product names remain unchanged unless the merchant supplies an approved localized name.

## Tone

- Use concise, polite, practical wording.
- Avoid particle-dependent templates unless particle logic is reviewed and tested.
- Avoid untranslated hype or English shorthand in locked exact offer lines.

## Production Gate

Korean may be used for development and internal preview while the reviewer is TBD. Broad Korean production use is blocked until a named Korean reviewer signs off on templates, fallback copy, counter registry entries, UI strings, accessibility labels, and representative screenshots.
