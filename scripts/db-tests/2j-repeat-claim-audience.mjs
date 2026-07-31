// D2.2j — the repeat-claim push audience filter's QUERIES, against a real schema.
//
// `supabase/functions/_shared/repeat-claim-audience.ts` stops a business's "new
// deal" push from reaching customers that same business has already blocked from
// claiming again. Its decision logic is unit-tested and hermetic
// (`repeat-claim-audience.test.ts`), but the two PostgREST reads it depends on had
// never run against a real database — and the module FAILS OPEN on any error, so
// a wrong column name or an unsupported operator would not raise anything. It
// would silently notify everyone, exactly as before the fix, and every unit test
// would still be green.
//
// So this suite deliberately does NOT re-test the decision logic. It issues the
// two reads byte-for-byte as supabase-js serializes them and asserts the rows
// that come back, plus the schema constraints the logic leans on:
//
//   Q1  businesses  .select(id,repeat_claim_policy_type,repeat_claim_cooldown_days).in(id,…)
//   Q2  deal_claims .select(user_id,business_id,redeemed_at)
//                   .in(user_id,…).in(business_id,…)
//                   .eq(claim_status,'redeemed').not(redeemed_at,'is',null)
//                   .order(redeemed_at, desc)
//
//   C1  the policy column can only ever hold the three literals
//       normalizeRepeatClaimPolicyType() knows, so its `NONE` default is never
//       reached by a real row.
//   C2  COOLDOWN_DAYS always carries a cooldown day count, so
//       evaluateRepeatClaimPolicy() can never fall into its `cooldownDays < 1`
//       no-block branch on live data.
//
// A failure here means the deploy of send-deal-push / weekly-deal-digest would
// have shipped a filter that quietly does nothing.
//
// Run: node scripts/db-tests/2j-repeat-claim-audience.mjs   (service_role required)

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
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2j repeat-claim push audience");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const created = { users: [], businesses: [], deals: [], claims: [] };

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const inList = (ids) => `in.(${ids.join(",")})`;

// --- the two reads, built exactly the way the helper's supabase-js calls do ----
//
// `.in()` leaves UUIDs unquoted (no commas or parens in them), `.not(col,'is',null)`
// becomes `col=not.is.null`, and `.order(col,{ascending:false})` becomes
// `order=col.desc`. Keep these in step with repeat-claim-audience.ts.

const POLICY_SELECT = "id,repeat_claim_policy_type,repeat_claim_cooldown_days";

function policyQuery(businessIds) {
  return `businesses?select=${POLICY_SELECT}&id=${inList(businessIds)}`;
}

function redemptionQuery(userIds, businessIds) {
  return (
    "deal_claims?select=user_id,business_id,redeemed_at" +
    `&user_id=${inList(userIds)}` +
    `&business_id=${inList(businessIds)}` +
    "&claim_status=eq.redeemed" +
    "&redeemed_at=not.is.null" +
    "&order=redeemed_at.desc"
  );
}

// --- fixtures ---------------------------------------------------------------

// businesses carries a UNIQUE index on owner_id (one self-created business per
// owner during the pilot), so every fixture shop needs its own throwaway owner.
//
// The shop also has to be genuinely live: enforce_new_claim_business_capability
// rejects a deal_claims insert unless get_business_capabilities() reports
// can_receive_new_claims, and it is a SECURITY DEFINER trigger, so service_role
// does not bypass it. Same trialing shape 2i uses.
async function seedBusiness(tag, name, policy) {
  const ownerId = await makeUser(`2j-owner-${tag}`, "business");
  const biz = await rest(ctx, "service", "businesses", {
    method: "POST",
    body: { owner_id: ownerId, name, status: "trialing", access_level: "full_trial", ...policy },
  });
  const businessId = biz.json?.[0]?.id;
  if (!businessId) {
    R.check(`fixture: business "${name}"`, false, {
      detail: `HTTP ${biz.status} ${String(biz.text).slice(0, 160)}`,
      onFail: "No fixture business, so every check below it is meaningless.",
    });
    return null;
  }
  created.businesses.unshift(businessId);
  // Carries the trialing access the capability trigger reads. activated_at is
  // only permitted alongside its provenance columns, and the checkout session id
  // is uniquely indexed, so both must be distinct per fixture.
  await rest(ctx, "service", "business_subscriptions", {
    method: "POST",
    body: {
      business_id: businessId,
      billing_mode: "web_stripe",
      billing_status: "trialing",
      app_access_status: "trialing",
      trial_type: "stripe_trial",
      trial_start: new Date(Date.now() - 864e5).toISOString(),
      trial_end: new Date(Date.now() + 10 * 864e5).toISOString(),
      activated_at: new Date(Date.now() - 864e5).toISOString(),
      activation_checkout_session_id: `cs_dbtest_${randomUUID()}`,
      activation_provider_event_id: `evt_dbtest_${randomUUID()}`,
      source: "db_test",
    },
  });
  // …and accepted business terms. Without this get_business_capabilities stops at
  // reason 'terms_required', which leaves can_receive_new_claims false and the
  // claim fixture unbuildable.
  await rest(ctx, "service", "terms_acceptances", {
    method: "POST",
    body: {
      business_id: businessId,
      user_id: ownerId,
      document_type: "business_terms",
      document_version: "db-test",
      source: "db_test",
    },
  });
  // Mirrors 2a: the deals write-guard resolves a location for every insert, so the
  // business needs a business_profiles row (id == businesses.id) and one location.
  await rest(ctx, "service", "business_profiles", {
    method: "POST",
    body: { id: businessId, user_id: ownerId, owner_id: ownerId, name },
  });
  await rest(ctx, "service", "business_locations", {
    method: "POST",
    body: { business_id: businessId, name: `${name} HQ`, address: "1 Test St" },
  });
  // is_active:false + is_recurring:true — this fixture only needs a deal row for
  // claims to hang off, not a publishable one (enforce_live_deal_business_capability).
  const deal = await rest(ctx, "service", "deals", {
    method: "POST",
    body: {
      business_id: businessId,
      title: "Buy one get one free",
      description: "BOGO",
      is_recurring: true,
      is_active: false,
      end_time: new Date(Date.now() + 864e5).toISOString(),
    },
  });
  const dealId = deal.json?.[0]?.id;
  if (!dealId) {
    R.check(`fixture: deal for "${name}"`, false, {
      detail: `HTTP ${deal.status} ${String(deal.text).slice(0, 160)}`,
    });
    return null;
  }
  created.deals.unshift(dealId);
  return { businessId, dealId };
}

/** A claim row. `redeemedAt` null leaves it active (the not-yet-redeemed case). */
async function seedClaim(shop, userId, { redeemedAt = null, status = "active" } = {}) {
  const claim = await rest(ctx, "service", "deal_claims", {
    method: "POST",
    body: {
      deal_id: shop.dealId,
      business_id: shop.businessId,
      user_id: userId,
      token: randomUUID(),
      expires_at: new Date(Date.now() + 864e5).toISOString(),
      claim_status: status,
      redeemed_at: redeemedAt,
      ...(redeemedAt ? { redeem_method: "visual" } : {}),
    },
  });
  const id = claim.json?.[0]?.id;
  if (!id) {
    R.check("fixture: deal_claims insert", false, {
      detail: `HTTP ${claim.status} ${String(claim.text).slice(0, 200)}`,
      onFail: "A rejected claim fixture makes the audience assertions vacuous.",
    });
    return null;
  }
  created.claims.unshift(id);
  return id;
}

async function makeUser(tag, role) {
  const id = await adminCreateUser(ctx, { email: uniqueEmail(tag), password: PW, role });
  created.users.push(id);
  return id;
}

// --- suite ------------------------------------------------------------------

async function main() {
  const none = await seedBusiness("none", "DBTest Open Cafe", {
    repeat_claim_policy_type: "NONE",
  });
  const forever = await seedBusiness("forever", "DBTest First Timers Only", {
    repeat_claim_policy_type: "FOREVER",
  });
  const cooldown = await seedBusiness("cooldown", "DBTest Weekly Cooldown", {
    repeat_claim_policy_type: "COOLDOWN_DAYS",
    repeat_claim_cooldown_days: 7,
  });
  if (!none || !forever || !cooldown) return;

  // repeatCustomer redeemed at all three. At the cooldown shop they redeemed
  // TWICE — 30 days ago and 2 days ago — which is the case that only the
  // newest-first ordering gets right (the stale row alone would look eligible).
  const repeatCustomer = await makeUser("2j-repeat", "customer");
  const holdsActive = await makeUser("2j-active", "customer");
  const stranger = await makeUser("2j-stranger", "customer");

  await seedClaim(none, repeatCustomer, { redeemedAt: daysAgo(2), status: "redeemed" });
  await seedClaim(forever, repeatCustomer, { redeemedAt: daysAgo(2), status: "redeemed" });
  await seedClaim(cooldown, repeatCustomer, { redeemedAt: daysAgo(30), status: "redeemed" });
  await seedClaim(cooldown, repeatCustomer, { redeemedAt: daysAgo(2), status: "redeemed" });
  // An active, never-redeemed claim. The filter must ignore it — holding a claim
  // right now is temporary and is a deliberate non-block (see the module header).
  await seedClaim(forever, holdsActive, { status: "active" });

  const businessIds = [none.businessId, forever.businessId, cooldown.businessId];
  const userIds = [repeatCustomer, holdsActive, stranger];

  // ------------------------------------------------------------------ Q1
  const policies = await rest(ctx, "service", policyQuery(businessIds));
  R.check("Q1 the policy read is accepted by PostgREST", policies.ok, {
    detail: `HTTP ${policies.status} ${String(policies.text).slice(0, 160)}`,
    onFail:
      "loadRestrictivePolicies() would log and fail open — the push filter silently does nothing.",
  });

  const byId = new Map((policies.json ?? []).map((row) => [row.id, row]));
  R.check(
    "Q1 returns every requested business, with both policy columns",
    byId.size === 3 &&
      businessIds.every(
        (id) =>
          byId.has(id) &&
          "repeat_claim_policy_type" in byId.get(id) &&
          "repeat_claim_cooldown_days" in byId.get(id),
      ),
    {
      detail: `rows=${byId.size} keys=${Object.keys(byId.get(businessIds[0]) ?? {}).join("|")}`,
      onFail: "A renamed column reaches the helper as undefined, which normalizes to NONE.",
    },
  );
  R.check(
    "Q1 round-trips the exact policy literals the normalizer switches on",
    byId.get(none.businessId)?.repeat_claim_policy_type === "NONE" &&
      byId.get(forever.businessId)?.repeat_claim_policy_type === "FOREVER" &&
      byId.get(cooldown.businessId)?.repeat_claim_policy_type === "COOLDOWN_DAYS" &&
      byId.get(cooldown.businessId)?.repeat_claim_cooldown_days === 7,
    {
      detail: `none=${byId.get(none.businessId)?.repeat_claim_policy_type} forever=${byId.get(forever.businessId)?.repeat_claim_policy_type} cooldown=${byId.get(cooldown.businessId)?.repeat_claim_policy_type}/${byId.get(cooldown.businessId)?.repeat_claim_cooldown_days}`,
      onFail:
        "normalizeRepeatClaimPolicyType() only recognizes NONE/FOREVER/COOLDOWN_DAYS; anything else becomes NONE and blocks nobody.",
    },
  );

  // ------------------------------------------------------------------ Q2
  const redemptions = await rest(ctx, "service", redemptionQuery(userIds, businessIds));
  R.check("Q2 the redemption read is accepted with every filter applied", redemptions.ok, {
    detail: `HTTP ${redemptions.status} ${String(redemptions.text).slice(0, 200)}`,
    onFail:
      "One of .in/.eq/.not(is,null)/.order is wrong — loadRepeatBlockedPairs() returns an empty set and nobody is filtered.",
  });

  const rows = Array.isArray(redemptions.json) ? redemptions.json : [];
  R.check(
    "Q2 returns exactly the redeemed rows, and only those",
    rows.length === 4 && rows.every((r) => r.user_id === repeatCustomer),
    {
      detail: `rows=${rows.length} distinct_users=${new Set(rows.map((r) => r.user_id)).size}`,
      onFail:
        "Either claim_status='redeemed' let a non-redemption through, or a real redemption was missed.",
    },
  );
  R.check(
    "Q2 excludes a customer whose only claim is still active",
    !rows.some((r) => r.user_id === holdsActive),
    {
      detail: `active-claim holder present=${rows.some((r) => r.user_id === holdsActive)}`,
      onFail:
        "Holding a claim right now would be treated as a permanent block — the deliberate non-change in the plan.",
    },
  );
  R.check(
    "Q2 excludes a customer with no claims at all",
    !rows.some((r) => r.user_id === stranger),
    { detail: `stranger present=${rows.some((r) => r.user_id === stranger)}` },
  );
  R.check(
    "Q2 selects only the three columns the pure selector reads",
    rows.length > 0 &&
      rows.every((r) => Object.keys(r).sort().join(",") === "business_id,redeemed_at,user_id"),
    {
      detail: `keys=${Object.keys(rows[0] ?? {}).sort().join("|")}`,
      onFail: "The select list drifted — extra columns mean extra PII crossing the function boundary.",
    },
  );

  // The whole "one ordered query is enough" design rests on this: for the shop
  // where the customer redeemed twice, the 2-day-old row must be seen first, or
  // selectRepeatBlockedPairs()'s first-row-wins would judge on the 30-day-old one
  // and let a customer inside a 7-day cooldown through.
  const cooldownRows = rows.filter((r) => r.business_id === cooldown.businessId);
  R.check(
    "Q2 orders newest-first, so first-row-per-pair is the latest redemption",
    cooldownRows.length === 2 &&
      Date.parse(cooldownRows[0].redeemed_at) > Date.parse(cooldownRows[1].redeemed_at) &&
      Date.now() - Date.parse(cooldownRows[0].redeemed_at) < 7 * 86_400_000,
    {
      detail: `rows=${cooldownRows.length} first=${cooldownRows[0]?.redeemed_at} second=${cooldownRows[1]?.redeemed_at}`,
      onFail:
        "first-row-per-pair would judge on a stale redemption and let a cooling-off customer through.",
    },
  );

  // The restricted-business narrowing the helper applies before Q2: a NONE shop
  // never reaches the redemption query at all.
  const restrictedOnly = await rest(
    ctx,
    "service",
    redemptionQuery(userIds, [forever.businessId, cooldown.businessId]),
  );
  R.check(
    "Q2 narrowed to restricted businesses drops the unrestricted shop's redemption",
    restrictedOnly.ok &&
      (restrictedOnly.json ?? []).length === 3 &&
      !(restrictedOnly.json ?? []).some((r) => r.business_id === none.businessId),
    {
      detail: `HTTP ${restrictedOnly.status} rows=${(restrictedOnly.json ?? []).length}`,
      onFail: "The business_id filter is not narrowing, so unrestricted shops cost a needless scan.",
    },
  );

  // ------------------------------------------------- chunk size assumption
  // USER_CHUNK = 300 exists so a big audience cannot 414 into a silent fail-open.
  // Prove 300 ids in one `.in()` is actually accepted; the real ids are padded
  // with throwaway UUIDs, so the row count must not change.
  const padded = [...userIds, ...Array.from({ length: 300 - userIds.length }, () => randomUUID())];
  const chunkProbe = await rest(ctx, "service", redemptionQuery(padded, businessIds));
  R.check(
    "USER_CHUNK of 300 ids in one .in() is accepted and returns the same rows",
    chunkProbe.ok && (chunkProbe.json ?? []).length === rows.length,
    {
      detail: `HTTP ${chunkProbe.status} ids=${padded.length} rows=${(chunkProbe.json ?? []).length} (expected ${rows.length})`,
      onFail:
        "300 is too many for one URL — every large audience fails open and nobody is filtered.",
    },
  );

  // --------------------------------------------------------------- C1 / C2
  // Both are why the helper can trust its inputs; neither can be proven in a
  // hermetic unit test. Each probe gets a FRESH owner and asserts the rejection
  // is a CHECK violation (23514) — a bare "the insert failed" would also be
  // satisfied by the unique-owner index, i.e. pass for the wrong reason.
  const badPolicy = await rest(ctx, "service", "businesses", {
    method: "POST",
    body: {
      owner_id: await makeUser("2j-bad-policy", "business"),
      name: "DBTest Bad Policy",
      repeat_claim_policy_type: "SOMETIMES",
    },
  });
  if (badPolicy.json?.[0]?.id) created.businesses.unshift(badPolicy.json[0].id);
  R.check(
    "C1 the policy column rejects any literal outside NONE/COOLDOWN_DAYS/FOREVER",
    !badPolicy.ok && badPolicy.json?.code === "23514",
    {
      detail: `HTTP ${badPolicy.status} code=${badPolicy.json?.code} ${String(badPolicy.json?.message ?? "").slice(0, 90)}`,
      onFail:
        "An unknown policy value would normalize to NONE and silently disable the block for that business.",
    },
  );

  const cooldownWithoutDays = await rest(ctx, "service", "businesses", {
    method: "POST",
    body: {
      owner_id: await makeUser("2j-cooldown-nodays", "business"),
      name: "DBTest Cooldown No Days",
      repeat_claim_policy_type: "COOLDOWN_DAYS",
    },
  });
  if (cooldownWithoutDays.json?.[0]?.id) created.businesses.unshift(cooldownWithoutDays.json[0].id);
  R.check(
    "C2 COOLDOWN_DAYS cannot exist without a cooldown day count",
    !cooldownWithoutDays.ok && cooldownWithoutDays.json?.code === "23514",
    {
      detail: `HTTP ${cooldownWithoutDays.status} code=${cooldownWithoutDays.json?.code} ${String(cooldownWithoutDays.json?.message ?? "").slice(0, 90)}`,
      onFail:
        "evaluateRepeatClaimPolicy() returns no block when cooldownDays < 1, so such a row would filter nobody.",
    },
  );
}

main()
  .catch((error) => {
    console.error("Unexpected error:", error);
    R.check("suite ran to completion", false, { detail: String(error) });
  })
  .finally(async () => {
    for (const id of created.claims) {
      await rest(ctx, "service", `deal_claims?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
    }
    for (const id of created.deals) {
      await rest(ctx, "service", `deals?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
    }
    for (const id of created.businesses) {
      await rest(ctx, "service", `business_subscriptions?business_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      const locations = await rest(ctx, "service", `business_locations?select=id&business_id=eq.${id}`).catch(() => null);
      for (const location of Array.isArray(locations?.json) ? locations.json : []) {
        await rest(ctx, "service", `location_entitlements?business_location_id=eq.${location.id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      }
      await rest(ctx, "service", `business_locations?business_id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      await rest(ctx, "service", `business_profiles?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
      await rest(ctx, "service", `businesses?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
    }
    for (const userId of created.users) await adminDeleteUser(ctx, userId);
    const { failed } = R.summary();
    process.exit(failed ? 1 : 0);
  });
