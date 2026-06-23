# Twofer es-US Style Guide

Status: pending native reviewer.

Current ownership:

- Internal localization owner: Dan / Twofer admin
- U.S. Spanish reviewer: TBD before production launch

## Exact Offer Mechanics

- Render the exact offer line from structured facts, not by translating a finished English sentence.
- Use U.S. Spanish (`es-US`) for labels, deterministic templates, and future persuasive transcreation.
- Current deterministic template family:
  - "Al comprar {paidQuantity} {paidItem}, recibes {rewardQuantity} {rewardItem} gratis"
  - "Recibe {discountPercent}% de descuento en {quantity} {item}"
- Business names and branded product names remain unchanged unless an approved localized name exists.
- Unknown or branded item names are preserved and flagged for review.

## Tone

- Keep the offer direct, warm, and understandable in two seconds.
- Avoid generic phrases such as "gran oferta" as the primary explanation.
- Avoid shorthand such as "2x1" in the locked exact offer line until explicitly reviewed.

## Production Gate

Spanish may be used for development and internal preview while the reviewer is TBD. Broad Spanish production use is blocked until a named U.S. Spanish reviewer signs off on templates, fallback copy, UI strings, accessibility labels, and representative screenshots.
