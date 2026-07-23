# Admin Command Center audit

The static `/admin` shell names dashboard, businesses, offers, billing, reports, prospects, and AI/support workflows. Live unauthenticated access returned the shell with no records and a disconnected-session state; the production dashboard-summary function returned 401 without auth.

Inspected functions use session, admin-role, section, and MFA helpers. Because static assets are public, those server checks—not route visibility—are the correct privilege boundary.

## F-015 — Public admin information architecture (P3)

The signed-out shell reveals internal workflow names. This is low-risk reconnaissance; no unauthorized data or action was demonstrated. Prefer a minimal noindex signed-out shell without embedded internal configuration while retaining every server control.

## Verification still required

No admin credential/MFA ceremony, role downgrade, cross-section denial, object-level access, mutation, audit record, billing action, moderation, or support impersonation workflow was executed. A release review needs a role-to-function/section matrix plus immutable audit records containing actor, target, reason, before/after state, and correlation ID without sensitive payloads.

