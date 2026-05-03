# Create Flow Simplification Recommendation (Pilot)

## Current Create Paths in `app/create/`

- `quick.tsx` - deprecated redirect to `/create/ai`.
- `ai.tsx` - unified create screen and publish path.
- `ai-compose.tsx` - compose-assist path.
- `reuse.tsx` - template/reuse entry that routes into `ai`.
- `menu-scan.tsx` - menu image scan/manual cleanup.
- `menu-manager.tsx` - saved menu library management.
- `menu-offer.tsx` - menu-item + offer-structure wizard that hands off to `ai`.
- `_layout.tsx` - registers stack routes including `ad-refine` (now backed by a placeholder route that redirects users to `/create/ai`).

## Recommended Primary Pilot Path

Use this as the default owner guidance for the MVP pilot:

1. Create Deal (entry from tab)
2. Choose Menu Item (`menu-scan` then `menu-offer`)
3. Choose Offer Type (`menu-offer` pairing/discount step)
4. Generate Ad (`menu-offer` hands structured hint into `ai`)
5. Review (`ai` ad review and guardrail checks)
6. Launch (publish from `ai`)

This aligns with the desired pilot path while preserving the strong-deal guardrail and existing publish logic.

## Which Paths Should Be Primary vs Secondary

- **Primary for pilot:** `menu-scan` -> `menu-offer` -> `ai` publish.
- **Secondary (keep available):** direct `ai` for experienced owners or fallback when menu flow is blocked.
- **Deferred/low-emphasis:** `ai-compose`, `reuse` until pilot feedback confirms they improve completion rate.
- **Technical cleanup candidate:** when a full refine flow returns, replace the current `/create/ad-refine` placeholder redirect screen with the final implementation.

## Smallest Safe UX Direction

- Keep all existing routes intact for now.
- Drive copy/CTA emphasis to the menu-first path in owner-facing screens and onboarding text.
- Avoid adding new route logic until pilot metrics confirm where owners are dropping off.
