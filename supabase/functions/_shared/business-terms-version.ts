// Single source of truth for the legal-document versions stamped onto
// terms_acceptances and promo_materials_authorizations rows.
//
// Kept in its own module (rather than inside business-onboarding-sync.ts) so
// that promo-materials.ts can stamp the terms version without creating an
// import cycle back into the onboarding sync, which imports it in turn.
//
// Bumped to 2026-07-19 for the "Promotional Materials" disclosure section added
// to the Business Terms. can_business_publish is version-agnostic by design, so
// this bump does NOT re-prompt existing businesses — see
// docs/plans/promo-materials-authorization-plan.md §11.
export const CURRENT_BUSINESS_TERMS_VERSION = "2026-07-19";
export const CURRENT_PRIVACY_POLICY_VERSION = "2026-07-01";
