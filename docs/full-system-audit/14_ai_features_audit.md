# AI features audit

AI poster/ad prompt, layout, publish, and lock files are product-locked. This audit made no changes to them.

## Verified controls

- Local and live legacy `ai-create-deal` behavior is intentional HTTP 410.
- `npm run copy:evaluate` passed 33 general, 3 poster, and 7 revision fixtures.
- `npm run gate:ai-ad` passed.
- The AI poster lock pretest passed within the full test suite.
- Versioned native-renderer/review paths, validation, and deterministic fallback concepts are present.
- Dev AI Studio documentation requires a separate dev Supabase project with publishing disabled.

## F-013 — Unmanaged remote AI function (P2)

Hosted inventory has one extra active slug: `ai-refine-ad-copy`. No local function directory exists. `docs/twofer-billing-remaining-work.md:108` confirms it was known and left deployed. Its authorization, prompt, provider/data handling, cost controls, sanitization, and callers cannot be reproduced from this source tree.

Under explicit AI-file/deployment approval, identify authoritative source and consumers. If obsolete, retire it and prove no callers remain; if required, restore reviewed source, tests, inventory docs, cost/privacy safeguards, and any applicable lock update before deployment.

## Unverified production assumptions

Hosted bundle parity, provider secret presence/mode, quotas/alerts, prompt injection against imports, provider retention, live cost ceilings, failure fallback, and production translation/fact fidelity were not tested. Deal facts must remain authoritative across copy, translation, revision, and image composition.

