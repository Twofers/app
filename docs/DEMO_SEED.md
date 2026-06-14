# Demo content, not demo login

The old combined demo/reviewer login must not be used for App Store or Play review, and credentials must never be committed. Use dedicated reviewer accounts for store review, with credentials entered only in Apple/Google review notes or local-only environment variables.

## Current status

- The legacy `demo@demo.com` Supabase Auth user is retained only as the owner record for sample Cedar & Bean content.
- That Auth user should remain banned/disabled so the old login cannot be used.
- Demo businesses/deals are sample content for tester visibility only. They are not real offers.

## Local smoke credentials

Scripts that need a real login read local environment variables only:

```sh
TWOFER_SMOKE_EMAIL=reviewer-or-local-test@example.com
TWOFER_SMOKE_PASSWORD=use-a-local-secret-here
```

Do not put real passwords in tracked files, screenshots, chat, pull requests, or docs. If reviewer credentials are needed for Apple or Google, enter them only in the review-note fields for that store submission.

## Demo content marker

Demo/sample rows should be marked in the database with `is_demo = true` so the app can show:

- `Demo offer`
- `This is sample content for testing only. Not a real offer.`

See the latest demo-content migration for the narrow ID-based Cedar & Bean marker. Apply it only through the normal Supabase migration workflow after review.

## Tester expectation

Testers may browse the sample Cedar & Bean business and deals to understand the app experience. Demo offers must not be represented as redeemable real business offers.
