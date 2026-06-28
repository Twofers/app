# Multilingual Deals PR4 Locale Screenshot QA

Date: 2026-06-23

Scope: this slice wires the existing deterministic per-locale presentation resolver into the owner approval path. It does not run a vision model, capture screenshots, start a release build, deploy an Edge Function, or apply a Supabase migration.

Runtime gate:

- `AI_V5_LOCALE_SCREENSHOT_QA_ENABLED`
- `EXPO_PUBLIC_AI_V5_LOCALE_SCREENSHOT_QA_ENABLED`

Both default off.

When locale presentation overrides are enabled, the Create AI review flow now evaluates the selected composed presentation against the generated localization bundle. The resolver may produce per-locale overrides and per-locale screenshot QA triggers. When locale screenshot QA is enabled and any locale is triggered, automatic localization approval is blocked until a real review path records a pass.

The current trigger source is deterministic:

- localized text-fit failure;
- exact offer line overflow;
- locale-safe template override that still needs visual review.

The approval blocker is selective: it records only the locales that need screenshot review instead of requiring all three locales to be reviewed for every deal.

Remaining limitations:

- Real-device screenshot capture and native visual review remain external QA steps.
- The hosted app will not use this path until the relevant Expo/public flags are enabled through an approved build/config path.
- Broad Spanish and Korean production use remains blocked until named reviewers and final sign-off are recorded in `docs/localization/native-review-log.md`.
