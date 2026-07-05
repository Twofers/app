# Twofer ko-KR Style Guide

Status: native reviewer signed off on 2026-07-03.

Current ownership:

- Internal localization owner: Dan / Twofer admin
- Korean reviewer: June

## Exact Offer Mechanics

- Render exact mechanics from structured facts. Do not translate a completed English offer sentence.
- Do not infer unreviewed Korean counters at runtime.
- Counter-free fallback templates remain acceptable for ambiguous items:
  - "구매 항목: {paidItem} x {paidQuantity}"
  - "추가 혜택: {rewardItem} x {rewardQuantity}"
  - "할인 항목: {item} x {quantity}"
  - "혜택: {discountPercent}% 할인"
- Business names and branded product names remain unchanged unless the merchant supplies an approved localized name.

## Tone

- Use concise, polite, practical wording.
- Avoid particle-dependent templates unless particle logic is reviewed and tested.
- Avoid untranslated hype or English shorthand in locked exact offer lines.

## Production Gate

June reviewed the Korean localization package and reported no issues on 2026-07-03. Broad Korean localization reviewer blockers are cleared, including Korean counter registry approval; production migrations, hosted flags, builds, deployments, and store submissions remain separately hard-gated.
