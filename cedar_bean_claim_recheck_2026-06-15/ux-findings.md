# Cedar & Bean Claim Recheck - 2026-06-15

Branch: `codex/customer-account-qa-fixes`
Runtime tested: Android emulator dev-client bundle.

## Remote Data Change Applied

- Applied migration `20260720120000_cedar_bean_claimable_qa_deal.sql`.
- Cedar & Bean Cafe is now non-demo.
- The live `Buy One Latte, Get One Free` deal is now non-demo, active, and claimable.
- Other Cedar & Bean sample deals remain per-deal `is_demo = true`.

## Verified

- Map live-deals card no longer shows the demo offer label for the claimable Cedar & Bean deal.
- Deal detail shows `Claim` and `Share deal` before claim, with no `View QR`/refresh action.
- Claim tap created one active/claimed customer claim for this deal.
- Remaining claim count decreased by one after claim.
- Post-claim detail shows `View QR` and `Share deal`.
- Wallet shows the new active Cedar & Bean ticket immediately after claim.
- Android native share sheet opens for Share Deal.

## Safety Notes

- No QR token, claim code, PIN, password, or auth token is included in these recheck notes.
- A screenshot was saved only for the pre-claim action state.
