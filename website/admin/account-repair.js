(() => {
  const Shell = window.TwoferAdminShell;
  let selectedUserId = "";
  let selectedBusinessId = "";

  const $ = (selector) => document.querySelector(selector);
  const text = (selector, value) => {
    const node = $(selector);
    if (node) node.textContent = String(value ?? "—");
  };
  const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
  const humanize = (value) => Shell.formatOptionLabel(value || "unknown");

  function setStatus(selector, message, tone = "") {
    const node = $(selector);
    if (!node) return;
    node.textContent = message;
    node.className = `status${tone ? ` ${tone}` : ""}`;
  }

  function addCell(row, label, value) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (value instanceof Node) cell.appendChild(value);
    else cell.textContent = String(value ?? "");
    row.appendChild(cell);
  }

  function renderAudit(rows) {
    const body = $("[data-repair-audit]");
    body.textContent = "";
    if (!rows?.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.className = "admin-row-detail";
      cell.textContent = "No recent account audit events.";
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    for (const item of rows.slice(0, 12)) {
      const row = document.createElement("tr");
      addCell(row, "Action", humanize(item.action));
      addCell(row, "Admin", item.admin_email || "System");
      addCell(row, "Reason", item.reason || "—");
      addCell(row, "Created", formatDate(item.created_at));
      body.appendChild(row);
    }
  }

  async function loadDetail(userId) {
    selectedUserId = userId;
    setStatus("[data-repair-action-status]", "Loading verified account state…");
    try {
      const payload = await Shell.adminPost("admin-account-management", { action: "detail", user_id: userId });
      const account = payload.account;
      const business = payload.businesses?.[0];
      selectedBusinessId = business?.id || "";
      const subscription = payload.subscriptions?.[0];
      $("[data-repair-detail]").hidden = false;
      text("[data-repair-title]", business?.name || account.email || account.user_id);
      text("[data-repair-meta]", `${account.email || "No email"} · ${humanize(account.role)} · ${humanize(account.account_status)}`);
      text("[data-repair-email-confirmed]", account.email_confirmed_at ? formatDate(account.email_confirmed_at) : "Not confirmed");
      text("[data-repair-last-sign-in]", formatDate(account.last_sign_in_at));
      text("[data-repair-mfa]", `${account.mfa_factors?.length || 0} enrolled`);
      text("[data-repair-suspension]", account.account_status === "suspended" ? account.suspension_reason || "Suspended" : "Not suspended");
      text("[data-repair-subscription]", subscription
        ? `${humanize(subscription.app_access_status)} · ${subscription.trial_end ? `ends ${formatDate(subscription.trial_end)}` : humanize(subscription.billing_status)}`
        : "No subscription");
      text("[data-repair-lockout]", payload.impact?.redemption_lockout_active
        ? `${payload.impact.recent_redemption_failures} recent failures`
        : "No active lockout");
      $("[data-open-directory-account]").href = `/admin/accounts?userId=${encodeURIComponent(userId)}`;
      $("[data-repair-actions] [name=email]").value = account.email || "";
      $("[data-repair-action=unlock]").hidden = !payload.impact?.redemption_lockout_active;
      $("[data-repair-action=suspend]").hidden = account.account_status !== "active";
      $("[data-repair-action=reactivate]").hidden = account.account_status !== "suspended";
      document.querySelectorAll("[data-repair-action]").forEach((button) => {
        button.disabled = payload.permissions?.can_repair !== true
          && !["suspend", "reactivate"].includes(button.dataset.repairAction);
      });
      renderAudit(payload.audit_log);
      setStatus("[data-repair-action-status]", "Account state loaded.", "success");
      $("[data-repair-detail]").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus("[data-repair-action-status]", error.message || "Could not load the account.", "error");
    }
  }

  function renderResults(rows) {
    const body = $("[data-repair-results]");
    body.textContent = "";
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "admin-row-detail";
      cell.textContent = "No matching account found.";
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    for (const account of rows) {
      const row = document.createElement("tr");
      addCell(row, "Account", account.email || account.user_id);
      addCell(row, "Role", humanize(account.role));
      addCell(row, "Status", humanize(account.account_status));
      addCell(row, "Business", account.business_name || account.zip_code || "—");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button button-small";
      button.textContent = "Open repair";
      button.addEventListener("click", () => loadDetail(account.user_id));
      addCell(row, "Action", button);
      body.appendChild(row);
    }
  }

  async function runRepair(action) {
    if (!selectedUserId) return;
    const form = $("[data-repair-actions]");
    const values = Object.fromEntries(new FormData(form).entries());
    const reason = String(values.reason || "").trim();
    if (reason.length < 5) {
      setStatus("[data-repair-action-status]", "Enter a reason of at least five characters.", "error");
      return;
    }
    const typed = {
      reset_mfa: ["RESET MFA", "Type RESET MFA to remove every TOTP factor."],
      correct_email: ["CONFIRM EMAIL", "Type CONFIRM EMAIL to change the login email. The business-claim email is not changed."],
      suspend: ["SUSPEND", "Type SUSPEND to block login and hide the business while preserving billing."],
    };
    let confirmation = "";
    if (typed[action]) {
      confirmation = window.prompt(typed[action][1]) || "";
      if (confirmation !== typed[action][0]) return;
    } else if (!window.confirm(`Run ${humanize(action)} for this account?`)) {
      return;
    }
    document.querySelectorAll("[data-repair-action]").forEach((button) => { button.disabled = true; });
    setStatus("[data-repair-action-status]", "Running audited repair…");
    try {
      await Shell.adminPost("admin-account-management", {
        action,
        user_id: selectedUserId,
        reason,
        confirmation,
        email: values.email,
        days: Number(values.days),
      });
      setStatus("[data-repair-action-status]", `${humanize(action)} completed and audited.`, "success");
      await loadDetail(selectedUserId);
    } catch (error) {
      setStatus("[data-repair-action-status]", error.message || "The repair failed.", "error");
    }
  }

  $("[data-repair-search-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") || "").trim();
    setStatus("[data-repair-search-status]", "Searching verified account records…");
    try {
      const payload = await Shell.adminPost("admin-account-management", {
        action: "list",
        query,
        page: 1,
        per_page: 50,
      });
      renderResults(payload.accounts || []);
      setStatus("[data-repair-search-status]", `${payload.accounts?.length || 0} matching account(s).`, "success");
    } catch (error) {
      setStatus("[data-repair-search-status]", error.message || "Search failed.", "error");
    }
  });

  document.querySelectorAll("[data-repair-action]").forEach((button) => {
    button.addEventListener("click", () => runRepair(button.dataset.repairAction));
  });
  $("[data-repair-owner-email]")?.addEventListener("click", () => {
    if (selectedBusinessId) window.TwoferOwnerEmail?.open({ businessId: selectedBusinessId, reason: "account_support" });
  });
  $("[data-repair-owner-view]")?.addEventListener("click", () => {
    if (selectedBusinessId) window.TwoferOwnerView?.open({ businessId: selectedBusinessId });
  });
  Shell.syncSessionActions();
})();
