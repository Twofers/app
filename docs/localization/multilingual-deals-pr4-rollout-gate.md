# Multilingual Deals PR4 Rollout Gate

Date: 2026-06-23

Scope: this gate makes the native-review and broad-production rollout state machine-checkable. It does not hide localized rendering or internal QA paths already built for PR4.

U.S. Spanish and Korean broad production rollout remains blocked until native reviewer sign-off and real-device native-language screenshot QA are recorded.

Current state:

- English (`en-US`) has internal owner review recorded for the localization-specific gate.
- U.S. Spanish (`es-US`) is available for internal QA, but broad production rollout remains blocked until a named U.S. Spanish reviewer signs off, localized templates are marked reviewed, and real-device native-language screenshot QA passes.
- Korean (`ko-KR`) is available for internal QA, but broad production rollout remains blocked until a named Korean reviewer signs off, localized templates and Korean counters are marked reviewed, and real-device native-language screenshot QA passes.

Use this local check during release prep:

```bash
npm run gate:localization-rollout
```

That command passes when the blocked state is explicit, traceable, and backed by the production approval runbook in `docs/localization/multilingual-deals-production-approval-runbook.md`. To turn the same check into a hard broad-production readiness assertion, run it with:

```bash
LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout
```

On Windows PowerShell:

```powershell
$env:LOCALIZATION_BROAD_PRODUCTION_ROLLOUT='true'
npm run gate:localization-rollout
Remove-Item Env:\LOCALIZATION_BROAD_PRODUCTION_ROLLOUT
```

Before that readiness assertion may pass, update all of these together:

- `docs/localization/native-review-log.md` with named reviewers, decisions, required changes, and final sign-off.
- `lib/localization-rollout-gate.ts` reviewer and screenshot QA statuses.
- `lib/offer-locale-templates.ts` review statuses for approved Spanish and Korean templates.
- `lib/korean-counter-registry.ts` reviewer approvals for Korean counters.
- Real-device screenshot QA evidence under local artifacts only, with no QR tokens, claim codes, or redemption codes transcribed into chat, docs, commits, or public artifacts.
- `docs/localization/multilingual-deals-production-approval-runbook.md` if the required migration, deploy, feature flag, acceptance, or rollback sequence changes.
