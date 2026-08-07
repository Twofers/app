(() => {
  const Shell = window.TwoferAdminShell;
  const queryParams = new URLSearchParams(window.location.search);
  const userId = queryParams.get("userId");
  const initialQuery = queryParams.get("q") || "";
  const requestedRole = queryParams.get("role") || "";
  const initialRole = requestedRole === "customer" || requestedRole === "business" ? requestedRole : "";
  let currentPage = 1;
  let total = 0;
  let perPage = 50;
  let detailPayload = null;

  const $ = (selector) => document.querySelector(selector);
  const statusEl = $("[data-admin-status]");
  const searchInput = $("[data-search]");
  const roleFilter = $("[data-role-filter]");
  if (searchInput && initialQuery) searchInput.value = initialQuery;
  if (roleFilter && initialRole) roleFilter.value = initialRole;

  async function post(body) {
    return Shell.adminPost("admin-account-management", body);
  }

  function setStatus(message, tone = "") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone ? ` ${tone}` : ""}`;
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
  }

  function badge(text) {
    const value = String(text || "unknown");
    const span = document.createElement("span");
    span.className = `admin-badge${/(suspended|archived|blocked|deleted)/i.test(value) ? " danger" : /(active|trialing)/i.test(value) ? " success" : ""}`;
    span.textContent = Shell.formatOptionLabel(value);
    return span;
  }

  function cell(row, label, value) {
    const td = document.createElement("td");
    td.dataset.label = label;
    if (value instanceof Node) td.appendChild(value);
    else td.textContent = String(value ?? "");
    row.appendChild(td);
  }

  function renderAccounts(payload) {
    const tbody = $("[data-account-rows]");
    tbody.textContent = "";
    for (const account of payload.accounts || []) {
      const tr = document.createElement("tr");
      cell(tr, "Account", account.email || account.user_id);
      cell(tr, "Role", badge(account.role));
      cell(tr, "Status", badge(account.account_status));
      cell(tr, "Business / ZIP", account.business_name || account.zip_code || "—");
      cell(tr, "Last sign-in", formatDate(account.last_sign_in_at));
      cell(tr, "Created", formatDate(account.auth_created_at));
      const link = document.createElement("a");
      link.href = `/admin/accounts?userId=${encodeURIComponent(account.user_id)}`;
      link.textContent = "Manage";
      cell(tr, "Action", link);
      tbody.appendChild(tr);
    }
    if (!tbody.children.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "admin-row-detail";
      td.textContent = "No accounts match these filters.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    total = payload.total || 0;
    perPage = payload.per_page || 50;
    $("[data-result-count]").textContent = `${total.toLocaleString()} account${total === 1 ? "" : "s"}`;
    $("[data-page-label]").textContent = `Page ${currentPage}`;
    $("[data-prev-page]").disabled = currentPage <= 1;
    $("[data-next-page]").disabled = currentPage * perPage >= total;
  }

  async function loadAccounts() {
    setStatus("Loading accounts…");
    try {
      const payload = await post({
        action: "list",
        query: $("[data-search]").value,
        role: $("[data-role-filter]").value,
        status: $("[data-status-filter]").value,
        page: currentPage,
        per_page: 50,
      });
      renderAccounts(payload);
      setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
    } catch (error) {
      setStatus(error.message || "Could not load accounts.", "danger");
    }
  }

  function setFormValue(form, name, value) {
    const field = form.elements.namedItem(name);
    if (field) field.value = value === null || value === undefined ? "" : String(value);
  }

  function renderAudit(rows) {
    const tbody = $("[data-audit-rows]");
    tbody.textContent = "";
    for (const item of rows || []) {
      const tr = document.createElement("tr");
      cell(tr, "Admin", item.admin_email || "");
      cell(tr, "Action", Shell.formatOptionLabel(item.action));
      cell(tr, "Reason", item.reason || "");
      cell(tr, "Created", formatDate(item.created_at));
      tbody.appendChild(tr);
    }
    if (!tbody.children.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.className = "admin-row-detail";
      td.textContent = "No account audit events yet.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  function renderDetail(payload) {
    detailPayload = payload;
    const account = payload.account;
    const business = payload.businesses?.[0] || null;
    const consumer = payload.consumer_profile || {};
    $("[data-account-title]").textContent = business?.name || account.email || account.user_id;
    $("[data-account-meta]").textContent = `${account.email || "No email"} | ${Shell.formatOptionLabel(account.role)} | Created ${formatDate(account.created_at)}`;
    $("[data-account-status]").replaceChildren(badge(account.account_status));
    $("[data-last-sign-in]").textContent = formatDate(account.last_sign_in_at);
    $("[data-stripe-count]").textContent = String(payload.impact?.stripe_subscriptions || 0);
    $("[data-business-count]").textContent = String(payload.impact?.businesses || 0);
    $("[data-deal-count]").textContent = String(payload.impact?.deals || 0);
    $("[data-claim-count]").textContent = String(payload.impact?.customer_claims || 0);

    const form = $("[data-profile-form]");
    setFormValue(form, "email", account.email);
    $("[data-business-fields]").hidden = account.role !== "business";
    $("[data-customer-fields]").hidden = account.role !== "customer";
    if (business) {
      for (const name of [
        "business_id", "name", "category", "short_description", "contact_name", "business_email",
        "public_email", "phone", "address", "address_line1", "address_line2", "city", "state",
        "postal_code", "country", "website_url", "instagram_url", "facebook_url", "hours_text",
        "pickup_note", "preferred_locale", "claim_notifications_enabled", "repeat_claim_policy_type",
        "repeat_claim_cooldown_days",
      ]) setFormValue(form, name, name === "business_id" ? business.id : business[name]);
    } else {
      for (const name of ["zip_code", "birthdate", "notification_mode", "radius_miles", "deal_alerts_enabled"]) {
        setFormValue(form, name, consumer[name]);
      }
    }
    $("[data-save-profile]").disabled = payload.permissions?.can_edit !== true;
    for (const button of document.querySelectorAll("[data-action]")) {
      button.disabled = payload.permissions?.can_manage_lifecycle !== true;
    }
    $("[data-action='suspend']").hidden = account.account_status !== "active";
    $("[data-action='reactivate']").hidden = account.account_status !== "suspended";
    $("[data-action='archive']").hidden = account.account_status === "archived";
    renderAudit(payload.audit_log);
  }

  async function loadDetail() {
    setStatus("Loading account…");
    try {
      const payload = await post({ action: "detail", user_id: userId });
      renderDetail(payload);
      setStatus("Account loaded");
    } catch (error) {
      setStatus(error.message || "Could not load account.", "danger");
    }
  }

  function formPayload(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    for (const name of ["claim_notifications_enabled", "deal_alerts_enabled"]) {
      if (name in values) values[name] = values[name] === "true";
    }
    return values;
  }

  async function runAction(action) {
    const destructive = action === "archive";
    const reasonEl = destructive ? $("[data-delete-reason]") : $("[data-lifecycle-reason]");
    const output = destructive ? $("[data-delete-status]") : $("[data-lifecycle-status]");
    const reason = reasonEl.value.trim();
    if (reason.length < 5) {
      output.textContent = "Enter a reason of at least five characters.";
      output.className = "status error";
      return;
    }
    let confirmation;
    if (action === "archive") {
      confirmation = window.prompt("Type ARCHIVE to cancel Stripe, block login, hide the account, and retain its records.");
      if (confirmation !== "ARCHIVE") return;
    }
    if (action === "suspend") {
      confirmation = window.prompt("Suspend this account? Login will be blocked and any business will be hidden. Stripe billing will continue. Type SUSPEND to continue.");
      if (confirmation !== "SUSPEND") return;
    }
    if (action === "reactivate" && !window.confirm("Reactivate this account and restore its eligible pre-suspension state?")) return;
    output.textContent = "Working…";
    output.className = "status";
    for (const button of document.querySelectorAll("[data-action]")) button.disabled = true;
    try {
      await post({ action, user_id: userId, reason, confirmation });
      output.textContent = action === "archive"
        ? "Account archived and Stripe billing canceled."
        : action === "suspend"
          ? "Account suspended. Data is preserved."
          : "Account reactivated.";
      output.className = "status success";
      await loadDetail();
    } catch (error) {
      output.textContent = error.message || "Action failed.";
      output.className = "status error";
      renderDetail(detailPayload);
    }
  }

  $("[data-admin-sign-out]")?.addEventListener("click", () => {
    Shell.signOut();
  });

  if (userId) {
    $("[data-directory-view]").hidden = true;
    $("[data-detail-view]").hidden = false;
    $("[data-profile-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const output = $("[data-profile-status]");
      output.textContent = "Saving…";
      output.className = "status";
      try {
        const values = formPayload(event.currentTarget);
        await post({ action: "update_profile", user_id: userId, ...values });
        output.textContent = "Profile changes saved and audited.";
        output.className = "status success";
        await loadDetail();
      } catch (error) {
        output.textContent = error.message || "Could not save profile.";
        output.className = "status error";
      }
    });
    for (const button of document.querySelectorAll("[data-action]")) {
      button.addEventListener("click", () => void runAction(button.dataset.action));
    }
    void loadDetail();
  } else {
    $("[data-search-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      currentPage = 1;
      void loadAccounts();
    });
    $("[data-clear-search]").addEventListener("click", () => {
      $("[data-search]").value = "";
      $("[data-role-filter]").value = "";
      $("[data-status-filter]").value = "";
      currentPage = 1;
      void loadAccounts();
    });
    $("[data-prev-page]").addEventListener("click", () => {
      currentPage = Math.max(1, currentPage - 1);
      void loadAccounts();
    });
    $("[data-next-page]").addEventListener("click", () => {
      currentPage += 1;
      void loadAccounts();
    });
    void loadAccounts();
  }
})();
