// D2.2e — approved merchant claim, public visibility, and publish gate.
//
// Requires migration 20260817120000 on the REMOTE TEST project.
// Run: node scripts/db-tests/2e-public-visibility-and-publish-gate.mjs

import { assertTestDb } from "../assert-test-db.mjs";
import {
  adminCreateUser,
  adminDeleteUser,
  isDenied,
  loadTestEnv,
  makeReporter,
  randomUUID,
  rest,
  signIn,
  uniqueEmail,
} from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url);

const R = makeReporter("2e approved claim + public visibility + publish gate");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const cleanup = { rows: [], users: [] };
const hoursFromNow = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();
const denied = (result) =>
  isDenied(result) ||
  /APPROVED_APPLICATION_CLAIM_REQUIRED|BUSINESS_PUBLISH_CAPABILITY_REQUIRED|P0001/i.test(result.text);

async function seed(table, body) {
  const response = await rest(ctx, "service", table, { method: "POST", body });
  const row = Array.isArray(response.json) ? response.json[0] : null;
  if (row?.id) cleanup.rows.unshift([table, row.id]);
  return { response, row };
}

async function main() {
  const ownerEmail = uniqueEmail("activation-owner");
  const ownerId = await adminCreateUser(ctx, {
    email: ownerEmail,
    password: PW,
    role: "business",
  });
  const shopperEmail = uniqueEmail("activation-shopper");
  const shopperId = await adminCreateUser(ctx, {
    email: shopperEmail,
    password: PW,
    role: "customer",
  });
  cleanup.users.push(ownerId, shopperId);
  const { token: ownerJwt } = await signIn(ctx, ownerEmail, PW);
  const { token: shopperJwt } = await signIn(ctx, shopperEmail, PW);

  const directCreate = await rest(ctx, "anon", "businesses", {
    token: ownerJwt,
    method: "POST",
    body: { owner_id: ownerId, name: "Direct Workspace Attempt" },
  });
  R.check("authenticated user cannot self-create a merchant workspace", denied(directCreate), {
    detail: `HTTP ${directCreate.status} ${directCreate.text}`,
    onFail: "Workspace creation bypassed the approved-email claim transaction.",
  });

  const { response: applicationResponse, row: application } = await seed("business_applications", {
    business_name: "Activation Test Cafe",
    contact_name: "Test Owner",
    email: ownerEmail,
    approved_email_normalized: ownerEmail.toLowerCase(),
    address: "100 Test Way, Dallas, TX",
    status: "approved_not_activated",
    access_tier: "approved_not_activated",
    verification_status: "verified_low_risk",
    terms_accepted: false,
    privacy_acknowledged: false,
  });
  if (!application?.id) {
    R.skip(
      "remaining checks",
      `approved application seed failed; apply 20260817120000 first: HTTP ${applicationResponse.status} ${applicationResponse.text}`,
    );
    return;
  }

  const wrongEmailClaim = await rest(
    ctx,
    "service",
    "rpc/claim_approved_business_application_for_user",
    {
      method: "POST",
      body: { p_user_id: ownerId, p_email: shopperEmail },
    },
  );
  R.check("wrong email cannot claim the approved application", denied(wrongEmailClaim), {
    detail: `HTTP ${wrongEmailClaim.status} ${wrongEmailClaim.text}`,
  });

  const [claimA, claimB] = await Promise.all([
    rest(ctx, "service", "rpc/claim_approved_business_application_for_user", {
      method: "POST",
      body: { p_user_id: ownerId, p_email: ownerEmail },
    }),
    rest(ctx, "service", "rpc/claim_approved_business_application_for_user", {
      method: "POST",
      body: { p_user_id: ownerId, p_email: ownerEmail.toUpperCase() },
    }),
  ]);
  const rowA = Array.isArray(claimA.json) ? claimA.json[0] : null;
  const rowB = Array.isArray(claimB.json) ? claimB.json[0] : null;
  const businessId = rowA?.business_id ?? rowB?.business_id;
  if (businessId) cleanup.rows.unshift(["businesses", businessId]);
  R.check(
    "concurrent case-insensitive claims are idempotent and return one workspace",
    claimA.ok &&
      claimB.ok &&
      Boolean(rowA?.business_id) &&
      rowA?.business_id === rowB?.business_id &&
      rowA?.application_id === rowB?.application_id,
    { detail: `A=${claimA.status}/${rowA?.business_id}, B=${claimB.status}/${rowB?.business_id}` },
  );
  if (!businessId) return;

  const subscription = await rest(
    ctx,
    "service",
    `business_subscriptions?select=id,billing_status,app_access_status,trial_start,trial_end,activated_at&business_id=eq.${businessId}`,
  );
  const subscriptionRow = subscription.json?.[0];
  if (subscriptionRow?.id) cleanup.rows.unshift(["business_subscriptions", subscriptionRow.id]);
  R.check(
    "claim creates only an inert subscription shell with no trial dates",
    subscriptionRow?.billing_status === "none" &&
      subscriptionRow?.app_access_status === "approved_not_activated" &&
      subscriptionRow?.trial_start == null &&
      subscriptionRow?.trial_end == null &&
      subscriptionRow?.activated_at == null,
    { detail: JSON.stringify(subscriptionRow ?? null) },
  );

  const locations = await rest(
    ctx,
    "service",
    `business_locations?select=id&business_id=eq.${businessId}`,
  );
  const locationId = locations.json?.[0]?.id;
  const credits = locationId
    ? await rest(
        ctx,
        "service",
        `deal_credit_periods?select=id&business_location_id=eq.${locationId}`,
      )
    : null;
  R.check(
    "claim grants no offer credit period",
    Boolean(locationId) && (credits?.json?.length ?? -1) === 0,
    { detail: `location=${locationId ?? "none"}, credit_periods=${credits?.json?.length ?? "n/a"}` },
  );

  const setupCapabilities = await rest(ctx, "anon", "rpc/get_business_capabilities", {
    token: ownerJwt,
    method: "POST",
    body: { p_business_id: businessId },
  });
  R.check(
    "setup capabilities allow profile/menu work but deny AI, publishing, and new claims",
    setupCapabilities.json?.can_edit_business_information === true &&
      setupCapabilities.json?.can_use_menu_tools === true &&
      setupCapabilities.json?.can_generate_ai === false &&
      setupCapabilities.json?.can_publish_offer === false &&
      setupCapabilities.json?.can_receive_new_claims === false,
    { detail: JSON.stringify(setupCapabilities.json ?? null) },
  );

  const anonRead = await rest(ctx, "anon", `businesses?select=id,name&id=eq.${businessId}`);
  const shopperRead = await rest(
    ctx,
    "anon",
    `businesses?select=id,name&id=eq.${businessId}`,
    { token: shopperJwt },
  );
  const ownerRead = await rest(
    ctx,
    "anon",
    `businesses?select=id,name&id=eq.${businessId}`,
    { token: ownerJwt },
  );
  R.check(
    "approved-not-activated business is private except to its owner",
    (anonRead.json?.length ?? -1) === 0 &&
      (shopperRead.json?.length ?? -1) === 0 &&
      (ownerRead.json?.length ?? 0) === 1,
    {
      detail: `anon=${anonRead.json?.length}, shopper=${shopperRead.json?.length}, owner=${ownerRead.json?.length}`,
    },
  );

  const profileEdit = await rest(ctx, "anon", `businesses?id=eq.${businessId}`, {
    token: ownerJwt,
    method: "PATCH",
    body: { short_description: "Prepared before activation" },
  });
  R.check("setup-only owner can edit business information", profileEdit.ok, {
    detail: `HTTP ${profileEdit.status} ${profileEdit.text}`,
  });

  const liveDeal = {
    business_id: businessId,
    title: "Buy one get one free",
    description: "BOGO",
    is_recurring: true,
    is_active: true,
    start_time: hoursFromNow(-1),
    end_time: hoursFromNow(24),
  };
  const liveDenied = await rest(ctx, "anon", "deals", {
    token: ownerJwt,
    method: "POST",
    body: liveDeal,
  });
  R.check("setup-only owner cannot direct-insert a live deal", denied(liveDenied), {
    detail: `HTTP ${liveDenied.status} ${liveDenied.text}`,
  });

  const draftResponse = await rest(ctx, "anon", "deals", {
    token: ownerJwt,
    method: "POST",
    body: { ...liveDeal, is_active: false },
  });
  const draft = Array.isArray(draftResponse.json) ? draftResponse.json[0] : null;
  if (draft?.id) cleanup.rows.unshift(["deals", draft.id]);
  R.check("setup-only owner can retain an inactive deal draft", draftResponse.ok && Boolean(draft?.id), {
    detail: `HTTP ${draftResponse.status} ${draftResponse.text}`,
  });
  if (!draft?.id || !locationId) return;

  await seed("terms_acceptances", {
    business_id: businessId,
    user_id: ownerId,
    document_type: "business_terms",
    document_version: "db-test-v1",
    source: "db_test",
  });
  await rest(ctx, "service", `businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: { status: "active", access_level: "paid" },
  });
  await rest(ctx, "service", `business_subscriptions?business_id=eq.${businessId}`, {
    method: "PATCH",
    body: { billing_status: "active", app_access_status: "active" },
  });
  await rest(ctx, "service", `business_applications?id=eq.${application.id}`, {
    method: "PATCH",
    body: { status: "active", access_tier: "active" },
  });
  await rest(ctx, "service", `location_entitlements?business_location_id=eq.${locationId}`, {
    method: "PATCH",
    body: { status: "paid_active" },
  });

  const activeCapabilities = await rest(ctx, "anon", "rpc/get_business_capabilities", {
    token: ownerJwt,
    method: "POST",
    body: { p_business_id: businessId },
  });
  R.check(
    "activated state enables AI and publishing capabilities",
    activeCapabilities.json?.can_generate_ai === true &&
      activeCapabilities.json?.can_publish_offer === true &&
      activeCapabilities.json?.can_receive_new_claims === true,
    { detail: JSON.stringify(activeCapabilities.json ?? null) },
  );

  const flipAllowed = await rest(ctx, "anon", `deals?id=eq.${draft.id}`, {
    token: ownerJwt,
    method: "PATCH",
    body: { is_active: true },
  });
  R.check("eligible owner can flip the inactive draft live", flipAllowed.ok, {
    detail: `HTTP ${flipAllowed.status} ${flipAllowed.text}`,
  });

  await rest(ctx, "service", `business_subscriptions?business_id=eq.${businessId}`, {
    method: "PATCH",
    body: { billing_status: "canceled", app_access_status: "expired" },
  });
  await rest(ctx, "service", `businesses?id=eq.${businessId}`, {
    method: "PATCH",
    body: { status: "trial_expired", access_level: "none" },
  });
  const deactivate = await rest(ctx, "anon", `deals?id=eq.${draft.id}`, {
    token: ownerJwt,
    method: "PATCH",
    body: { is_active: false },
  });
  R.check("lapsed owner can still deactivate a previously live deal", deactivate.ok, {
    detail: `HTTP ${deactivate.status} ${deactivate.text}`,
  });
}

main()
  .catch((error) => {
    console.error("Unexpected error:", error);
    R.check("suite ran to completion", false, { detail: String(error) });
  })
  .finally(async () => {
    for (const [table, id] of cleanup.rows) {
      await rest(ctx, "service", `${table}?id=eq.${id}`, {
        method: "DELETE",
        prefer: "return=minimal",
      }).catch(() => {});
    }
    for (const userId of cleanup.users) await adminDeleteUser(ctx, userId);
    const { failed } = R.summary();
    process.exit(failed ? 1 : 0);
  });
