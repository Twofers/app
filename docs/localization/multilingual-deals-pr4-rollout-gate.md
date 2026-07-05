# Multilingual Deals PR4 Rollout Gate

Date: 2026-06-23

Scope: this gate makes the native-review and broad-production rollout state machine-checkable. It does not hide localized rendering or internal QA paths already built for PR4.

U.S. Spanish and Korean localization reviewer sign-off is recorded as of 2026-07-03.

Current state:

- English (`en-US`) has internal owner review recorded for the localization-specific gate.
- U.S. Spanish (`es-US`) has Juan recorded as reviewer, localized templates marked reviewed, and native-language screenshot QA marked passed.
- Korean (`ko-KR`) has June recorded as reviewer, localized templates and Korean counters marked reviewed, and native-language screenshot QA marked passed.

Use this local check during release prep:

```bash
npm run gate:localization-plan
npm run gate:localization-rollout
```

The plan audit maps PR1-PR4 requirements and required automated tests to current repo evidence. The rollout gate passes when the signoff state is explicit, traceable, and backed by the production approval runbook in `docs/localization/multilingual-deals-production-approval-runbook.md`. To turn the rollout gate into a hard broad-production readiness assertion, run it with:

```bash
LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout
```

On Windows PowerShell:

```powershell
$env:LOCALIZATION_BROAD_PRODUCTION_ROLLOUT='true'
npm run gate:localization-rollout
Remove-Item Env:\LOCALIZATION_BROAD_PRODUCTION_ROLLOUT
```

The readiness assertion may pass only when all of these are updated together:

- `docs/localization/native-review-log.md` with named reviewers, decisions, required changes, and final sign-off.
- `docs/localization/multilingual-deals-native-acceptance-packet.md` with every required PR4 native-speaker and real-device scenario mapped to evidence.
- `lib/localization-rollout-gate.ts` reviewer and screenshot QA statuses.
- `lib/offer-locale-templates.ts` review statuses for approved Spanish and Korean templates.
- `lib/korean-counter-registry.ts` reviewer approvals for Korean counters.
- Real-device screenshot QA evidence under local artifacts only, with no QR tokens, claim codes, or redemption codes transcribed into chat, docs, commits, or public artifacts.
- `docs/localization/multilingual-deals-production-approval-runbook.md` if the required migration, deploy, feature flag, acceptance, or rollback sequence changes.
