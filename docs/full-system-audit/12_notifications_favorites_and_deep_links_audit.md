# Notifications, favorites, and deep links audit

## Surface

The mobile app includes favorites, notification consent/preferences, Expo push-token flows, deal/claim notifications, weekly digest, owner claim push, universal/app link configuration, wallet synchronization, and Share Deal links.

## Static assessment

- Push sending is centralized in shared/function helpers and invoked as follow-up work around claims and scheduled messaging.
- Acquisition/deep-link sources are normalized in claim logic.
- App/site association paths and runtime feature flags exist in configuration.
- Share Deal is enabled in production configuration but the public web landing does not resolve a deal (F-009).
- Store destinations are null (F-010), so installed/not-installed routing cannot complete the intended acquisition loop.

## Risks and gaps

No dedicated P1/P2 defect was confirmed solely in favorites or notification storage. However, push/wallet follow-up must be retryable and must not reverse an authoritative claim/redemption transaction. Validate stale/revoked push-token cleanup, per-user authorization, deduplication, notification preference enforcement, quiet/error behavior, and privacy-safe payloads.

Real-device push permission/delivery/tap, background/killed app behavior, universal/app links, malformed links, installed/not-installed paths, favorites synchronization, weekly digest scheduling, and wallet update/revoke were blocked. The public share defect is detailed in the next report.

