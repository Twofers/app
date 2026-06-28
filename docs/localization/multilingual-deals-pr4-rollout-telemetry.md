# Multilingual Deals PR4 Rollout Telemetry

Date: 2026-06-23

Scope: this slice adds non-sensitive localization dimensions to the existing `ai_ad_versioned_publish` analytics event. It supports rollout dashboards after the hosted `publish-offer-version` function is redeployed; no deploy, migration, release build, or hosted flag change was performed here.

The event now records:

- localization source locale, enabled locales, and enabled locale count;
- source creative hash, localization bundle hash, renderer version, approval hash, localized term snapshot hash, and locale override hash;
- deterministic fallback locales and count;
- translation QA status/decision rollup by locale;
- semantic QA provider/model/skip reason;
- targeted repair locales and count;
- locale presentation override locales and count;
- localization row locales, row count, and approved row-hash locales.

The event does not record localized headline text, supporting copy, image alt text, merchant freeform copy, customer identifiers beyond existing event ownership fields, QR tokens, claim codes, redemption codes, idempotency keys, or secrets.

Dashboard dimensions this enables:

- source-locale publish mix;
- deterministic fallback rate by source locale;
- repair-target rate by target locale;
- semantic QA skip/coverage rate;
- locale presentation override rate;
- approved localization bundle coverage;
- localization row coverage per published deal.

Remaining limitations:

- Hosted analytics will not include these fields until Dan explicitly approves redeploying `publish-offer-version`.
- Native-review defect rate still requires reviewer workflow data from `docs/localization/native-review-log.md` or a future review database.
- Real-device screenshot QA remains a separate hard-gated evidence trail and was not performed in this local slice.
