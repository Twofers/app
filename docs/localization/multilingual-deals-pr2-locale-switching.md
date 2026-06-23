# Multilingual Deals PR 2 - Locale Switching Notes

Status: implemented locally behind default-off flags.

## Scope

- Owner create flow now has a fixed source-language selector behind `AI_V5_LOCALIZED_OWNER_UI_ENABLED`.
- Owner composed preview can switch among `en-US`, `es-US`, and `ko-KR` without changing the generated image, claim settings, schedule, inventory, or publish target.
- Customer feed can resolve deal display locale behind `AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED`.
- Customer deal detail can persist a preferred deal language and switch the rendered deal text behind `AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED`.

## Storage And Compatibility

- Published `deals.source_locale` remains the existing short app locale (`en`, `es`, `ko`) because the applied migration check constraint allows only those values.
- Client customer preference is stored locally under `twoforone.consumer.preferred_locale` as a product locale (`en-US`, `es-US`, `ko-KR`).
- No Supabase migration, Edge Function redeploy, release build, or hosted config change was performed.

## Locale Resolution

Customer display locale resolution follows the PR1 resolver:

1. explicit customer deal-language preference;
2. current app language;
3. supported device language;
4. English fallback;
5. source-locale fallback.

The language switch changes presentation text only. Deal ID, business ID, claim state, inventory cap, and analytics attribution stay tied to the same deal row.

## Telemetry

- Existing `deal_viewed` and `deal_opened` events now include `customer_render_locale` and `locale_resolution_source` when customer locale resolution is enabled.
- New `deal_language_switched` analytics event records the selected rendered locale for detail-screen language switches.

## Review Gate

The new owner/customer UI strings are development-ready but not broadly production-ready for Spanish or Korean until named native reviewers sign off in `docs/localization/native-review-log.md`.
