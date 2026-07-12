# Finding 06: Visual redeem lets the customer's own device complete a redemption (no staff proof)

Severity: Medium
Surface: PIN redemption / trust model
Files:
- `supabase/functions/begin-visual-redeem/index.ts` (customer starts a countdown on their own claim)
- `supabase/functions/complete-visual-redeem/index.ts:127-201` (customer's device marks the claim redeemed after a 14s–120s window)
- `supabase/functions/_shared/claim-redeem.ts:19` (`VISUAL_REDEEM_AUTO_FINALIZE_MS = 30s` auto-finalize)
Status: NOT STARTED

## What is wrong

Separate from the RLS hole in Finding 02 (which lets a customer forge a
redemption directly), the **intended** visual-redeem flow already lets the
customer self-complete a redemption: `begin-visual-redeem` sets
`claim_status='redeeming'`, and after a ~14-second wait `complete-visual-redeem`
sets `redeemed_at` — all driven by the customer's own device and JWT, with no
cryptographic evidence a staff member was present. The staff "verification" is a
human glancing at a countdown animation on the customer's phone.

This may be an intentional low-friction design for a pilot. But it means the
answer to the audit's question "can the client self-report redemption success?"
is **yes, by design**, for the visual path. The only server checks are: the
claim is the caller's, it isn't expired, and ≥14s elapsed. A customer can burn
their own claim to a "redeemed ✓" screen anywhere (e.g. at home) and present
that screen — there is no location binding on the visual path (unlike the staff
path, which enforces `redemption_devices.location_id`).

## Exploit or failure path

- A customer starts and completes a visual redeem without any staff device
  involved, producing a legitimate-looking "redeemed" screen, then shows it to
  staff to collect the reward. There is no `redemptions` audit row for the
  visual path (that table is written only by the staff RPC), and no location
  check, so nothing ties the redemption to the store.
- Because it's the customer's own single claim, the *direct* loss is bounded to
  one reward per claim (INV-2 still caps re-use once Finding 02 is fixed) — this
  is a weaker-verification concern, not unlimited fraud, which is why it's Medium
  not Critical.

## The fix — DECISION CONFIRMED (Dan, 2026-07-06): Option 1

Keep customer-completed visual redeem for the pilot, and harden it: add a
store/location binding to the completion and write a `redemptions` audit row so
every redemption (staff, owner, visual) shares one auditable trail. Implement
**Option 1 below**; Options 2/3 are recorded only as the tracked post-pilot
direction — do not implement them now.

Options, in increasing strictness:

1. **Keep as-is** (accept honor-system visual redeem for the pilot). Then at
   least: bind the visual completion to the store the same way the staff path is
   bound — record `redeemed_at_location_id` and, if the client sends a location,
   reject completion when it doesn't match the deal's `location_id` (mirrors the
   `WRONG_LOCATION_REDEMPTION` check in `redeem-token`). And write a
   `redemptions` audit row for visual completions so all redemptions share one
   audit trail.
2. **Require staff acknowledgement.** Make the terminal "redeemed" state require
   the staff device / owner PIN to confirm, so the customer device alone can
   only reach a "pending staff tap" state. This makes staff the deciding party
   (matches INV-1's spirit).
3. **Remove the customer-completed path** and route all redemptions through the
   staff device (`staff-redemption`) or owner `redeem-token`.

Recommended default: **option 1 for the pilot** (cheapest, adds a location bind
+ audit row and closes the "redeem from home" gap), with option 2 tracked for
post-pilot. Confirm with Dan before implementing, since 2/3 change the in-store
UX.

## How to verify

- Option 1: complete a visual redeem with a spoofed/mismatched location and
  confirm it is rejected; confirm a `redemptions` row now exists for a visual
  completion with the correct `location_id`.
- Option 2/3: confirm a customer device alone can no longer reach `redeemed`;
  only a staff/owner action finalizes it.

## Do NOT

- Do **not** implement this before Finding 02 — 02 is the actual security bug
  (forged/looped redemption). This finding is about the *intended* flow's trust
  level and needs a product decision.
- Do **not** shorten or remove the 14s timer thinking it's the security control;
  it is a UX pacing device, not a fraud control.
- Do **not** silently change the redemption UX (options 2/3) without Dan's
  sign-off — it affects how every merchant redeems in person.
