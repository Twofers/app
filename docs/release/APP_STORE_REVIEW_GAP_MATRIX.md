# Twofer App Store Review Gap Matrix

Date: 2026-07-01

| Area | Status | Evidence | Risk | Required Action | Owner | Priority |
|---|---|---|---|---|---|---|
| Mobile Stripe/IAP posture | Improved | Mobile billing flags default false; production/preview EAS set false; billing routes/deep links gated | Med | Verify exact TestFlight build uses these flags | Dan | P0 |
| Merchant access | Improved | `lib/merchant-access.ts`, `use-primary-location-billing-gate` | Med | Verify hosted entitlements give reviewer merchant `trial_active`, `admin_trial_active`, `pro_active`, or `paid_active` | Dan | P0 |
| App metadata | Drafted | `APP_STORE_METADATA_DRAFT.md` | Med | Paste final metadata into App Store Connect | Dan | P0 |
| Screenshots | Planned | `APP_STORE_SCREENSHOT_PLAN.md` | Med | Capture/upload final iPhone screenshots from real review build | Dan | P0 |
| Review notes | Drafted | `APPLE_REVIEW_NOTES_DRAFT.md` | High | Add real credentials in App Store Connect only | Dan | P0 |
| Demo accounts/data | Not locally verifiable | Placeholders in review notes | High | Verify consumer and active merchant demo accounts plus sample offers | Dan | P0 |
| Privacy policy | Reviewed live | `website/privacy/index.html`, `APP_PRIVACY_DISCLOSURE_DRAFT.md`; live privacy page checked after deploy | Low | Keep App Store privacy answers matched to exact submitted build | Dan | P0 |
| Terms/support pages | Reviewed live | `website/terms`, `website/support`, `website/business-terms`, `website/delete-account` | Low | Keep final App Store URLs pointed at `https://www.twoferapp.com` | Dan | P0 |
| Business onboarding | Smoke tested live | `website/business`, `business_applications` migration, Edge Function; non-sensitive QA submission returned `200 {"ok":true}` | Low/Med | Remove or ignore the clearly marked QA application record if desired | Dan/Codex | P1 |
| Universal/App Links | iOS and Android association files deployed | `website/.well-known/*` | Low | Verify on real devices after final store builds install | Dan | P1 |
| Account deletion | Existing implementation | App settings/account + `delete-user-account` | Med | Test disposable accounts on hosted review backend | Dan | P0 |
| Location permission | Existing implementation | GPS/ZIP fallback, no background location | Med | Test deny-location path on iPhone | Dan | P1 |
| Push notifications | Existing implementation | Optional alerts/settings flows | Med | Test opt-in, opt-out, token cleanup on device | Dan | P1 |
| Offer reporting | Improved | Deal detail now says “Report this offer”; existing reports RPC | Med | Test report submission on hosted backend | Dan/Codex | P1 |
| Empty market/reviewer fallback | Partial | Review notes and website copy mention Dallas-first | High | Ensure reviewer account sees sample Dallas offer outside Dallas | Dan | P0 |
| Supabase production state | Business intake migration/function deployed | Hosted migration list, function smoke checks | Med | Continue hosted smoke for reviewer/demo paths without exposing secrets | Dan | P0 |
| Release build | Not run | Hard gate | High | Build only after explicit approval | Dan | P0 |

## Payment Classification

Current local code is now suitable for the “web-only/outside-app billing, no mobile purchase CTA” submission posture, pending verification of the exact TestFlight build. Stripe backend/web/admin code remains present, but mobile production flags fail closed and the app surfaces neutral inactive-business support language instead of checkout or pricing.
