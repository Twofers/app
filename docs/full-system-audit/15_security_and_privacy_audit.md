# Security and privacy audit

## Highest security/privacy risks

- F-001: direct authorization bypass at the publication boundary.
- F-002: public exposure/discovery before business approval.
- F-003: reusable merchant invite authority shipped to clients.
- F-005: caller-controlled Checkout selection.
- F-006: replay race in checkout tokens.
- F-013: unmanaged deployed AI surface.

## Positive evidence

Gitleaks found no committed secret leak across the scanned history. No secrets, auth tokens, push tokens, QR/claim/redemption codes, keys, certificates, profiles, or config values are reproduced here. Unauthenticated live admin/claim/redeem paths failed closed. Provider-error sanitization and shared auth/CORS helpers exist.

## Abuse surface

Anonymous/low-trust routes include auth/reset, business/launch forms, public business/share/claim links, billing-link exchange, analytics ingestion, and AI/imports. Prove rate limits, normalized identity, size/type limits, replay protection, enumeration resistance, and privacy-safe logging for each. Some limiters use forwarding headers; whether the hosting proxy overwrites attacker-supplied chains was not proven and remains a test gap.

## Privacy

The live policy describes ephemeral voice audio, consistent with the product rule that only transcript/log metadata may remain. Production rows, backups, provider dashboards, retention jobs, deletion propagation, DSAR evidence, and processor contracts were not inspected.

Before launch, maintain a field-level inventory of purpose, consent/legal basis, processor, retention, deletion, access, and logging for identity, ZIP/location, birthday/age band, business contacts, claims, Stripe identifiers, push tokens, wallet, AI inputs, analytics, and admin access.

