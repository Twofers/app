// D2.2i — the claim LINKS an already-activated business instead of rewriting it.
//
// Guards two distinct failures that the same function produced (F-21):
//
//   LOCKOUT   an application that advanced to an active-looking status before its
//             owner first signed in matched no branch of the claim, so the RPC
//             returned nothing, the dashboard saw business:null, and the merchant
//             was told "Business setup opens after your application is approved"
//             forever — while the enforcement side considered them fully active.
//
//   DOWNGRADE an application still sitting at approved_not_activated whose business
//             had already been activated by another path (admin comp grant, Stripe
//             webhook) DID match, and the claim then rewrote businesses.status and
//             access_level back to 'approved_not_activated'. Because
//             get_business_capabilities evaluates setup access first and defines
//             active access as "NOT setup access", that single UPDATE switched off
//             publishing, AI and new claims for a live business.
//
// The DOWNGRADE shape is why the first attempt at the lockout fix was reverted on
// 2026-07-24: widening WHO reaches the link path, while the link path still
// rewrote state, would have knocked live businesses offline.
//
// Run BEFORE applying 20260822170000 and you should see S3a and S3b fail — that is
// the bug reproducing. Run after applying it and everything should pass.
//
// Run: node scripts/db-tests/2i-claim-links-activated-business.mjs

import { assertTestDb } from "../assert-test-db.mjs";
import {
  adminCreateUser,
  adminDeleteUser,
  loadTestEnv,
  makeReporter,
  randomUUID,
  rest,
  uniqueEmail,
} from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url);

const R = makeReporter("2i claim links activated business");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const cleanup = { rows: [], users: [] };
const hoursFromNow = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString();

// cleanup.rows entries are [table, postgrestFilter] — not every child table this
// suite touches is keyed by `id` (business_setup_ai_allowances and
// business_billing_profiles are keyed by business_id).
async function seed(table, body) {
  const response = await rest(ctx, "service", table, { method: "POST", body });
  const row = Array.isArray(response.json) ? response.json[0] : null;
  if (row?.id) cleanup.rows.unshift([table, `id=eq.${row.id}`]);
  // Fail loudly. A silently-rejected fixture row produces a degenerate "before"
  // state that can make a broken claim look like a passing test — which is
  // exactly what happened while this suite was being written.
  if (!response.ok) {
    R.check(`fixture seed into ${table}`, false, {
      detail: `HTTP ${response.status} ${(response.json?.message ?? response.text ?? "").slice(0, 160)}`,
      onFail: "The fixture never existed, so every check below it is meaningless.",
    });
  }
  return { response, row };
}

async function claim(userId, email) {
  return rest(ctx, "service", "rpc/claim_approved_business_application_for_user", {
    method: "POST",
    body: { p_user_id: userId, p_email: email },
  });
}

const claimRow = (result) => (Array.isArray(result.json) ? result.json[0] : null);

/**
 * The access-relevant slice of get_business_capabilities: reason_code plus every
 * can_* flag.
 *
 * Read as service_role on purpose — get_business_capabilities short-circuits the
 * membership test for service_role, so the snapshot reflects ONLY the
 * billing/status logic. Reading as the owner would also move across the claim
 * (they gain a membership row), which would muddy a before/after comparison of
 * the thing we actually care about.
 *
 * setup_menu_extractions_remaining is deliberately excluded: the claim inserts a
 * business_setup_ai_allowances shell (ON CONFLICT DO NOTHING), which can move that
 * number without touching access.
 */
async function capabilities(businessId) {
  const result = await rest(ctx, "service", "rpc/get_business_capabilities", {
    method: "POST",
    body: { p_business_id: businessId },
  });
  const json = result.json ?? {};
  const slice = { reason_code: json.reason_code ?? null };
  for (const key of Object.keys(json).filter((k) => k.startsWith("can_")).sort()) {
    slice[key] = json[key];
  }
  return slice;
}

async function readBusiness(businessId) {
  const result = await rest(
    ctx,
    "service",
    `businesses?select=id,name,status,access_level,owner_id&id=eq.${businessId}`,
  );
  return result.json?.[0] ?? null;
}

async function readApplication(applicationId) {
  const result = await rest(
    ctx,
    "service",
    `business_applications?select=id,status,access_tier,claimed_by_user_id,business_id&id=eq.${applicationId}`,
  );
  return result.json?.[0] ?? null;
}

async function readSubscription(businessId) {
  const result = await rest(
    ctx,
    "service",
    `business_subscriptions?select=id,billing_status,app_access_status,activated_at,trial_end&business_id=eq.${businessId}`,
  );
  const row = result.json?.[0] ?? null;
  if (row?.id) cleanup.rows.unshift(["business_subscriptions", `id=eq.${row.id}`]);
  return row;
}

/** Register whatever the claim created so the fixture cleans up after itself. */
async function trackCreatedChildren(businessId) {
  const locations = await rest(
    ctx,
    "service",
    `business_locations?select=id&business_id=eq.${businessId}`,
  );
  for (const location of Array.isArray(locations.json) ? locations.json : []) {
    cleanup.rows.unshift(["location_entitlements", `business_location_id=eq.${location.id}`]);
    cleanup.rows.unshift(["business_locations", `id=eq.${location.id}`]);
  }
  for (const table of [
    "business_members",
    "business_billing_profiles",
    "business_setup_ai_allowances",
    "business_onboarding_requests",
  ]) {
    cleanup.rows.unshift([table, `business_id=eq.${businessId}`]);
  }
}

/** A business owner + their approved application, optionally pre-materialized. */
async function makeOwner(tag) {
  const email = uniqueEmail(tag);
  const userId = await adminCreateUser(ctx, { email, password: PW, role: "business" });
  cleanup.users.push(userId);
  return { email, userId };
}

async function makeApplication(owner, overrides = {}) {
  const { row } = await seed("business_applications", {
    business_name: `Claim Link ${overrides.tag ?? "Cafe"}`,
    contact_name: "Test Owner",
    email: owner.email,
    approved_email_normalized: owner.email.toLowerCase(),
    address: "200 Link Way, Dallas, TX",
    status: "approved_not_activated",
    access_tier: "approved_not_activated",
    verification_status: "verified_low_risk",
    terms_accepted: false,
    privacy_acknowledged: false,
    ...(({ tag, ...rest }) => rest)(overrides),
  });
  return row;
}

/**
 * A business that is genuinely live.
 *
 * The default access_level is 'none', which is the shape that actually bites.
 * businesses.access_level is NOT NULL, so the drift is never a null — it is a
 * business whose billing advanced to trialing while access_level was left at
 * 'none' (what resolveBusinessAccessLevelForAppAccessStatus writes for a lapsed
 * or not-yet-synced account). 'none' is inside the claim's UPDATE guard
 * (`COALESCE(access_level,'none') IN ('none','pending','approved_not_activated')`),
 * so the old claim rewrote the row; 'full_trial' is outside it, so a cleanly
 * synced business only ever hit the lockout, never the downgrade.
 */
async function makeActivatedBusiness(owner, { accessLevel = "none", status = "trialing" } = {}) {
  const { row: business } = await seed("businesses", {
    owner_id: owner.userId,
    name: "Already Live Coffee",
    business_email: owner.email,
    address: "300 Live Way, Dallas, TX",
    status,
    access_level: accessLevel,
  });
  if (!business?.id) return null;
  await seed("business_subscriptions", {
    business_id: business.id,
    billing_mode: "web_stripe",
    billing_status: "trialing",
    app_access_status: "trialing",
    trial_type: "stripe_trial",
    trial_start: hoursFromNow(-24),
    trial_end: hoursFromNow(24 * 10),
    // activated_at is only permitted alongside its provenance columns
    // (business_subscriptions_activation_requires_trialing), and the checkout
    // session id is uniquely indexed — so it has to be distinct per fixture.
    activated_at: hoursFromNow(-24),
    activation_checkout_session_id: `cs_dbtest_${randomUUID()}`,
    activation_provider_event_id: `evt_dbtest_${randomUUID()}`,
    source: "db_test",
  });
  return business;
}

function sameCapabilities(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}

async function main() {
  // ---------------------------------------------------------------- S1: new
  {
    const owner = await makeOwner("s1-new");
    const application = await makeApplication(owner, { tag: "S1" });
    if (!application?.id) {
      R.skip("S1 materialize a new business", `application seed failed`);
    } else {
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      if (row?.business_id) {
        cleanup.rows.unshift(["businesses", `id=eq.${row.business_id}`]);
        await trackCreatedChildren(row.business_id);
      }
      const business = row?.business_id ? await readBusiness(row.business_id) : null;
      R.check(
        "S1 a fresh approved application materializes an inert workspace",
        result.ok &&
          Boolean(row?.business_id) &&
          business?.status === "approved_not_activated" &&
          business?.access_level === "approved_not_activated" &&
          business?.owner_id === owner.userId,
        {
          detail: `HTTP ${result.status} status=${business?.status} access_level=${business?.access_level}`,
          onFail: "The normal onboarding path regressed — this is the majority path.",
        },
      );
    }
  }

  // ------------------------------------------------------- S2: existing inert
  {
    const owner = await makeOwner("s2-inert");
    const { row: business } = await seed("businesses", {
      owner_id: owner.userId,
      name: "Placeholder Name",
      status: "approved_not_activated",
      access_level: "approved_not_activated",
    });
    const application = business?.id
      ? await makeApplication(owner, { tag: "S2", business_id: business.id })
      : null;
    if (!application?.id) {
      R.skip("S2 link an existing inert business", "fixture seed failed");
    } else {
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      await trackCreatedChildren(business.id);
      const after = await readBusiness(business.id);
      R.check(
        "S2 an inert business is still linked AND filled in from the application",
        result.ok &&
          row?.business_id === business.id &&
          after?.name === application.business_name &&
          after?.status === "approved_not_activated",
        {
          detail: `HTTP ${result.status} name=${after?.name} status=${after?.status}`,
          onFail: "The setup path stopped seeding the workspace from the application.",
        },
      );
    }
  }

  // ------------------------- S3a: LOCKOUT — active-looking application status
  {
    const owner = await makeOwner("s3a-lockout");
    // Cleanly synced (access_level full_trial) so this shape tests ONLY the
    // lockout — the claim's rewrite guard cannot fire here either way.
    const business = await makeActivatedBusiness(owner, { accessLevel: "full_trial" });
    const application = business?.id
      ? await makeApplication(owner, {
          tag: "S3a",
          business_id: business.id,
          status: "trial_active",
          access_tier: "trialing",
        })
      : null;
    if (!application?.id) {
      R.skip("S3a trialing merchant can claim", "fixture seed failed");
    } else {
      const before = await capabilities(business.id);
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      await trackCreatedChildren(business.id);
      const after = await capabilities(business.id);
      const applicationAfter = await readApplication(application.id);

      R.check(
        "S3a a trialing merchant whose application advanced can claim their workspace",
        result.ok && row?.business_id === business.id,
        {
          detail: `HTTP ${result.status} returned=${row?.business_id ?? "NOTHING"} (before fix: NOTHING — the lockout)`,
          onFail:
            "F-21 lockout: the claim matched no branch, so the dashboard shows approval_required forever.",
        },
      );
      R.check(
        "S3a the claim stamps the application instead of leaving it unclaimed",
        applicationAfter?.claimed_by_user_id === owner.userId &&
          applicationAfter?.business_id === business.id,
        { detail: `claimed_by=${applicationAfter?.claimed_by_user_id ?? "null"}` },
      );
      R.check(
        "S3a claiming does not change what the business is allowed to do",
        sameCapabilities(before, after),
        {
          detail: `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          onFail: "The claim altered a live business's access while linking it.",
        },
      );
    }
  }

  // ------- S3b: DOWNGRADE — setup-status application over an activated business
  {
    const owner = await makeOwner("s3b-downgrade");
    const business = await makeActivatedBusiness(owner);
    const application = business?.id
      ? await makeApplication(owner, { tag: "S3b", business_id: business.id })
      : null;
    if (!application?.id) {
      R.skip("S3b activated business is not downgraded", "fixture seed failed");
    } else {
      const before = await capabilities(business.id);
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      await trackCreatedChildren(business.id);
      const after = await capabilities(business.id);
      const businessAfter = await readBusiness(business.id);
      const subscriptionAfter = await readSubscription(business.id);

      // Assert on signals that activation alone controls. can_publish_offer is
      // NOT one of them: it also requires accepted business terms, which this
      // fixture deliberately does not grant, so it is false in both snapshots.
      R.check(
        "S3b precondition: the business really was live before the claim",
        before.reason_code === "active" && before.can_generate_ai === true,
        { detail: `before=${JSON.stringify(before)}` },
      );
      R.check(
        "S3b claiming a live business does NOT switch off its capabilities",
        result.ok && sameCapabilities(before, after),
        {
          detail: `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          onFail:
            "THE BUG: the claim rewrote status/access_level to approved_not_activated, " +
            "which makes get_business_capabilities treat a live business as still in setup.",
        },
      );
      R.check(
        "S3b the business row keeps its live status and access level",
        businessAfter?.status === "trialing" && businessAfter?.access_level !== "approved_not_activated",
        { detail: `status=${businessAfter?.status} access_level=${businessAfter?.access_level}` },
      );
      R.check(
        "S3b billing state is left entirely alone",
        subscriptionAfter?.app_access_status === "trialing" &&
          subscriptionAfter?.billing_status === "trialing" &&
          subscriptionAfter?.activated_at != null,
        {
          detail: `app_access=${subscriptionAfter?.app_access_status} billing=${subscriptionAfter?.billing_status}`,
          onFail: "The claim wrote billing rows for an already-activated account.",
        },
      );
      R.check(
        "S3b the merchant's own business name survives the claim",
        businessAfter?.name === "Already Live Coffee",
        {
          detail: `name=${businessAfter?.name}`,
          onFail: "A months-old application form overwrote a live business's name.",
        },
      );

      // ------------------------------------------------- S6: idempotency
      const second = await claim(owner.userId, owner.email);
      const secondRow = claimRow(second);
      const afterSecond = await capabilities(business.id);
      R.check(
        "S6 claiming twice returns the same workspace and changes nothing",
        second.ok &&
          secondRow?.business_id === row?.business_id &&
          secondRow?.application_id === row?.application_id &&
          sameCapabilities(after, afterSecond),
        { detail: `first=${row?.business_id} second=${secondRow?.business_id}` },
      );
    }
  }

  // ----------------------------------------------------------- S4: comped
  {
    const owner = await makeOwner("s4-comped");
    const { row: business } = await seed("businesses", {
      owner_id: owner.userId,
      name: "Comped Corner",
      status: "active",
      access_level: "admin_comped",
    });
    // A real comp grant writes a subscription row too (applyBusinessBillingAccessState).
    // Without one, get_business_capabilities returns NULL for most flags — see the
    // note in the plan doc — which would make this comparison meaningless.
    if (business?.id) {
      // No activated_at here: the activation constraint only permits it for the
      // stripe-ish access statuses, and a comp is granted by an admin, not a
      // checkout. The comp is carried by access_level + app_access_status.
      await seed("business_subscriptions", {
        business_id: business.id,
        billing_mode: "admin_comp",
        billing_status: "admin_comped",
        app_access_status: "comped",
        source: "db_test",
      });
    }
    const application = business?.id
      ? await makeApplication(owner, { tag: "S4", business_id: business.id })
      : null;
    if (!application?.id) {
      R.skip("S4 comped business is not downgraded", "fixture seed failed");
    } else {
      const before = await capabilities(business.id);
      const result = await claim(owner.userId, owner.email);
      await trackCreatedChildren(business.id);
      const after = await capabilities(business.id);
      const businessAfter = await readBusiness(business.id);
      R.check(
        "S4 a comped business keeps its comp through the claim",
        result.ok &&
          businessAfter?.access_level === "admin_comped" &&
          sameCapabilities(before, after),
        {
          detail: `access_level=${businessAfter?.access_level} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
          onFail: "A comp granted by an admin was erased by the owner signing in.",
        },
      );
    }
  }

  // ------------------------------------------- S5: someone else's business
  {
    const owner = await makeOwner("s5-claimant");
    const stranger = await makeOwner("s5-stranger");
    const { row: business } = await seed("businesses", {
      owner_id: stranger.userId,
      name: "Not Your Cafe",
      status: "trialing",
      access_level: "full_trial",
    });
    const application = business?.id
      ? await makeApplication(owner, { tag: "S5", business_id: business.id })
      : null;
    if (!application?.id) {
      R.skip("S5 cannot claim another owner's business", "fixture seed failed");
    } else {
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      const businessAfter = await readBusiness(business.id);
      R.check(
        "S5 a stranger's business is never handed over by the claim",
        !row?.business_id && businessAfter?.owner_id === stranger.userId,
        {
          detail: `HTTP ${result.status} returned=${row?.business_id ?? "nothing"} owner unchanged=${businessAfter?.owner_id === stranger.userId}`,
          onFail: "AUTHORIZATION REGRESSION: the widened status list changed WHO may claim.",
        },
      );
    }
  }

  // ------------------- S8: two unclaimed matching applications on one email
  //
  // Widening the status list also widened the old AMBIGUOUS_APPROVED_APPLICATION_EMAIL
  // raise, which get-business-onboarding-context rethrows as HTTP 500. Nothing
  // stops one email holding several applications. The claim must now resolve this
  // deterministically, preferring the approved_not_activated row.
  {
    const owner = await makeOwner("s8-ambiguous");
    const first = await makeApplication(owner, {
      tag: "S8-active-looking",
      status: "trial_active",
      access_tier: "trialing",
    });
    const second = await makeApplication(owner, { tag: "S8-setup" });
    if (!first?.id || !second?.id) {
      R.skip("S8 two matching applications", "fixture seed failed");
    } else {
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      if (row?.business_id) {
        cleanup.rows.unshift(["businesses", `id=eq.${row.business_id}`]);
        await trackCreatedChildren(row.business_id);
      }
      R.check(
        "S8 two matching applications resolve instead of failing the dashboard",
        result.ok && Boolean(row?.application_id),
        {
          detail: `HTTP ${result.status} ${(result.json?.message ?? "").slice(0, 90)}`,
          onFail:
            "AMBIGUOUS_APPROVED_APPLICATION_EMAIL — the merchant dashboard 500s and there is no way out of it.",
        },
      );
      R.check(
        "S8 the approved_not_activated application is preferred over the active-looking one",
        row?.application_id === second.id,
        {
          detail: `picked=${row?.application_id === second.id ? "approved_not_activated" : "OTHER"}`,
          onFail: "The tie-break stopped matching today's behaviour when a setup row exists.",
        },
      );

      const repeat = await claim(owner.userId, owner.email);
      R.check(
        "S8 the choice is stable when called again",
        repeat.ok && claimRow(repeat)?.application_id === row?.application_id,
        { detail: `first=${row?.application_id} second=${claimRow(repeat)?.application_id}` },
      );
    }
  }

  // ------- S9: a claimed application with no business, plus an unclaimed one
  //
  // This is a real production shape: one email carries a claimed application AND
  // an unclaimed one. business_applications has a UNIQUE index on
  // claimed_by_user_id, so if the claimed row ever loses its business_id the claim
  // would fall through and try to stamp the SECOND row — a unique violation, which
  // aborts the transaction and 500s the dashboard.
  {
    const owner = await makeOwner("s9-claimed-no-business");
    const claimed = await makeApplication(owner, {
      tag: "S9-claimed",
      status: "trial_active",
      claimed_by_user_id: owner.userId,
      claimed_at: hoursFromNow(-72),
    });
    const unclaimed = await makeApplication(owner, {
      tag: "S9-unclaimed",
      status: "trial_limited",
    });
    if (!claimed?.id || !unclaimed?.id) {
      R.skip("S9 claimed application with no business", "fixture seed failed");
    } else {
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      const unclaimedAfter = await readApplication(unclaimed.id);
      R.check(
        "S9 a user who already claimed never has a second application stamped",
        result.ok && unclaimedAfter?.claimed_by_user_id === null,
        {
          detail: `HTTP ${result.status} returned=${row?.application_id ?? "nothing"} second_row_claimed_by=${unclaimedAfter?.claimed_by_user_id ?? "null"}`,
          onFail:
            "Unique violation on idx_business_applications_claimed_once — the whole claim transaction aborts and the dashboard 500s.",
        },
      );
      R.check(
        "S9 the existing claim is returned rather than falling through",
        row?.application_id === claimed.id,
        { detail: `returned=${row?.application_id} expected=${claimed.id}` },
      );
    }
  }

  // ------------------------------------------------- S7: already-claimed path
  {
    const owner = await makeOwner("s7-claimed");
    const business = await makeActivatedBusiness(owner, { accessLevel: "full_trial" });
    const application = business?.id
      ? await makeApplication(owner, {
          tag: "S7",
          business_id: business.id,
          status: "trial_active",
          claimed_by_user_id: owner.userId,
          claimed_at: hoursFromNow(-48),
        })
      : null;
    if (!application?.id) {
      R.skip("S7 already-claimed application returns early", "fixture seed failed");
    } else {
      const before = await capabilities(business.id);
      const result = await claim(owner.userId, owner.email);
      const row = claimRow(result);
      const after = await capabilities(business.id);
      R.check(
        "S7 an already-claimed application returns its existing workspace untouched",
        result.ok && row?.business_id === business.id && sameCapabilities(before, after),
        { detail: `HTTP ${result.status} returned=${row?.business_id}` },
      );
    }
  }
}

main()
  .catch((error) => {
    console.error("Unexpected error:", error);
    R.check("suite ran to completion", false, { detail: String(error) });
  })
  .finally(async () => {
    // Two passes: fixtures are registered newest-first, but a couple of rows
    // (an application pointing at a business created later by the claim) can only
    // go once their sibling is gone.
    for (let pass = 0; pass < 2; pass++) {
      for (const [table, filter] of cleanup.rows) {
        await rest(ctx, "service", `${table}?${filter}`, {
          method: "DELETE",
          prefer: "return=minimal",
        }).catch(() => {});
      }
    }
    for (const userId of cleanup.users) await adminDeleteUser(ctx, userId);
    const { failed } = R.summary();
    process.exit(failed ? 1 : 0);
  });
