// 2f — business name lock + name change request queue (spoof prevention).
//
// Requires migration 20260816120000 (name lock + business_name_change_requests)
// applied to the REMOTE TEST project, on top of 20260814120000/130000.
//
// Proves:
//   1. Pre-approval (pending_verification) the owner can freely correct the name.
//   2. Once the business is publicly visible (status=active) a direct REST
//      rename by the owner is REJECTED (business_name_locked / 42501) and the
//      stored name does not change — closing the impersonation path.
//   3. Non-name profile edits still work after approval (no owner lockout).
//   4. The owner can file exactly ONE pending name change request, cannot
//      self-approve it, can cancel it, and anon sees nothing.
//   5. service_role (the admin approval path) can still rename.
//
// Run: node scripts/db-tests/2f-business-name-lock.mjs

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest, signIn,
         adminCreateUser, adminDeleteUser, uniqueEmail, isDenied, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2f business name lock");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const cleanup = { rows: [], users: [] };

async function main() {
  const ownerEmail = uniqueEmail("namelock-owner");
  const ownerId = await adminCreateUser(ctx, { email: ownerEmail, password: PW, role: "business" });
  cleanup.users.push(ownerId);
  const { token: ownerJwt } = await signIn(ctx, ownerEmail, PW);

  const createRes = await rest(ctx, "service", "businesses", {
    method: "POST",
    body: {
      owner_id: ownerId,
      name: "Name Lock Cafe",
      status: "pending_verification",
      access_level: "none",
    },
  });
  const biz = Array.isArray(createRes.json) ? createRes.json[0] : null;
  if (biz?.id) cleanup.rows.unshift(["businesses", biz.id]);
  if (!biz?.id) {
    R.check("service fixture can create a pending business", false, { detail: `HTTP ${createRes.status} ${createRes.text}` });
    return;
  }

  // --- 1. pre-approval: name corrections are free -------------------------
  const preRename = await rest(ctx, "anon", `businesses?id=eq.${biz.id}`, {
    token: ownerJwt, method: "PATCH", body: { name: "Name Lock Cafe (fixed typo)" },
  });
  const preName = await rest(ctx, "service", `businesses?select=name&id=eq.${biz.id}`);
  R.check("pre-approval owner rename succeeds", !isDenied(preRename) && preName.json?.[0]?.name === "Name Lock Cafe (fixed typo)",
    { detail: `HTTP ${preRename.status}, name=${preName.json?.[0]?.name}`,
      onFail: "Lock fires before approval — owners can no longer fix typos during setup (app bug)." });

  // --- 2. approve, then a direct REST rename must fail --------------------
  await rest(ctx, "service", `businesses?id=eq.${biz.id}`, { method: "PATCH", body: { status: "active" } });

  const renameDenied = await rest(ctx, "anon", `businesses?id=eq.${biz.id}`, {
    token: ownerJwt, method: "PATCH", body: { name: "Totally Different Brand" },
  });
  const lockedName = await rest(ctx, "service", `businesses?select=name&id=eq.${biz.id}`);
  R.check("post-approval owner rename is rejected (business_name_locked)",
    isDenied(renameDenied) && /business_name_locked/i.test(renameDenied.text) && lockedName.json?.[0]?.name === "Name Lock Cafe (fixed typo)",
    { detail: `HTTP ${renameDenied.status} ${renameDenied.text}, name=${lockedName.json?.[0]?.name}`,
      onFail: "SPOOF REGRESSION: an approved business renamed itself via direct REST — trigger check missing (app bug)." });

  // --- 3. other profile edits still work after approval --------------------
  const otherEdit = await rest(ctx, "anon", `businesses?id=eq.${biz.id}`, {
    token: ownerJwt, method: "PATCH", body: { short_description: "Still editable", name: "Name Lock Cafe (fixed typo)" },
  });
  R.check("post-approval non-name edit (same name resent) still succeeds", !isDenied(otherEdit),
    { detail: `HTTP ${otherEdit.status} ${otherEdit.text}`,
      onFail: "Lock too broad — older builds resend the unchanged name on every save and would break (app bug)." });

  // --- 4. name change request queue ----------------------------------------
  const reqInsert = await rest(ctx, "anon", "business_name_change_requests", {
    token: ownerJwt, method: "POST",
    body: {
      business_id: biz.id,
      requested_by: ownerId,
      current_value: "Name Lock Cafe (fixed typo)",
      proposed_value: "Name Lock Cafe & Bakery",
      reason: "We rebranded",
    },
  });
  const request = Array.isArray(reqInsert.json) ? reqInsert.json[0] : null;
  if (request?.id) cleanup.rows.unshift(["business_name_change_requests", request.id]);
  R.check("owner can file a name change request", reqInsert.ok && Boolean(request?.id),
    { detail: `HTTP ${reqInsert.status} ${request?.id ? "" : reqInsert.text}` });

  if (request?.id) {
    const duplicate = await rest(ctx, "anon", "business_name_change_requests", {
      token: ownerJwt, method: "POST",
      body: { business_id: biz.id, requested_by: ownerId, proposed_value: "Another Name" },
    });
    const dupRow = Array.isArray(duplicate.json) ? duplicate.json[0] : null;
    if (dupRow?.id) cleanup.rows.unshift(["business_name_change_requests", dupRow.id]);
    R.check("second pending request is blocked (one open request per business)", !duplicate.ok,
      { detail: `HTTP ${duplicate.status} ${duplicate.text}` });

    const selfApprove = await rest(ctx, "anon", `business_name_change_requests?id=eq.${request.id}`, {
      token: ownerJwt, method: "PATCH", body: { status: "approved" },
    });
    const stillPending = await rest(ctx, "service", `business_name_change_requests?select=status&id=eq.${request.id}`);
    R.check("owner cannot self-approve the request", isDenied(selfApprove) && stillPending.json?.[0]?.status === "pending",
      { detail: `HTTP ${selfApprove.status}, status=${stillPending.json?.[0]?.status}`,
        onFail: "Owner self-approval allowed — WITH CHECK on the update policy is broken (app bug)." });

    const anonRead = await rest(ctx, "anon", `business_name_change_requests?select=id&business_id=eq.${biz.id}`);
    R.check("anon cannot read name change requests", (anonRead.json?.length ?? 0) === 0,
      { detail: `HTTP ${anonRead.status}, rows=${anonRead.json?.length}` });

    const cancelReq = await rest(ctx, "anon", `business_name_change_requests?id=eq.${request.id}`, {
      token: ownerJwt, method: "PATCH", body: { status: "canceled" },
    });
    const canceled = await rest(ctx, "service", `business_name_change_requests?select=status&id=eq.${request.id}`);
    R.check("owner can cancel their own pending request", !isDenied(cancelReq) && canceled.json?.[0]?.status === "canceled",
      { detail: `HTTP ${cancelReq.status}, status=${canceled.json?.[0]?.status}` });
  }

  // --- 5. the privileged path (admin approval) still renames ---------------
  const adminRename = await rest(ctx, "service", `businesses?id=eq.${biz.id}`, {
    method: "PATCH", body: { name: "Name Lock Cafe & Bakery" },
  });
  const finalName = await rest(ctx, "service", `businesses?select=name&id=eq.${biz.id}`);
  R.check("service_role (admin approval path) can rename", !isDenied(adminRename) && finalName.json?.[0]?.name === "Name Lock Cafe & Bakery",
    { detail: `HTTP ${adminRename.status}, name=${finalName.json?.[0]?.name}`,
      onFail: "Trigger blocks privileged renames — admin approval cannot apply names (app bug)." });
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    R.check("suite ran to completion", false, { detail: String(err) });
  })
  .finally(async () => {
    for (const [table, id] of cleanup.rows) {
      await rest(ctx, "service", `${table}?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
    }
    for (const u of cleanup.users) await adminDeleteUser(ctx, u);
    const { failed } = R.summary();
    process.exit(failed ? 1 : 0);
  });
