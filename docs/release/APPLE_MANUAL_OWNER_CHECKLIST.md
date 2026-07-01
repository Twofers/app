# Apple Manual Owner Checklist

## App Store Connect

- [ ] Verify Apple Developer account is active.
- [ ] Confirm bundle ID: `com.unvmex2.twoforone`.
- [ ] Confirm app version and selected build number match the intended TestFlight build.
- [ ] Confirm the uploaded build uses the current Apple SDK requirement.
- [ ] Upload final iPhone screenshots.
- [ ] Enter metadata from `APP_STORE_METADATA_DRAFT.md`.
- [ ] Enter privacy labels from `APP_PRIVACY_DISCLOSURE_DRAFT.md` after legal review.
- [ ] Enter age rating.
- [ ] Set support URL: `https://www.twoferapp.com/support`.
- [ ] Set privacy URL: `https://www.twoferapp.com/privacy`.
- [ ] Paste review notes with real credentials only in App Store Connect.
- [ ] Confirm app pricing is free for consumers.
- [ ] Confirm no in-app purchases are submitted for launch.
- [ ] Choose manual or automatic release.
- [ ] Submit for review.
- [ ] Monitor App Review messages.

## Website / Domains

- [x] Deploy `website/` to `https://www.twoferapp.com`.
- [x] Verify `https://www.twoferapp.com/delete-account` is live and linked from support/privacy.
- [x] Review live privacy, terms, business terms, support, and delete-account pages for launch-posture consistency.
- [ ] Redirect `https://www.gettwofer.com` to `https://www.twoferapp.com`.
- [ ] Redirect `https://gettwofer.com` to `https://www.twoferapp.com`.
- [x] Replace `TEAMID` in `website/.well-known/apple-app-site-association`.
- [x] Add Android Play App Signing SHA-256 to `website/.well-known/assetlinks.json`.
- [x] Verify `/business`, `/business/thanks`, `/support`, `/privacy`, `/terms`, `/business-terms`, `/delete-account`, and `/s/` load.

## Supabase / Backend

- [x] Apply `20260730123000_business_applications.sql` after approval.
- [x] Deploy `submit-business-application` after approval.
- [x] Submit one non-sensitive production business-application smoke test.
- [ ] Verify hosted deletion, reporting, claim/redeem, AI, push, and billing-status functions are deployed.
- [ ] Verify reviewer merchant entitlement is active and requires no payment flow.
- [ ] Do not expose secrets in screenshots, docs, logs, or chat.
