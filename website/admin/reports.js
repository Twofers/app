(() => {
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const reportsEndpoint = document.body.dataset.adminReportsEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const reportsStatusEl = document.querySelector("[data-reports-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const businessBody = document.querySelector("[data-business-reports-body]");
  const userBody = document.querySelector("[data-user-reports-body]");

  const BUSINESS_REASON_LABELS = {
    not_honored: "Didn't honor the offer",
    doesnt_exist: "Business doesn't exist",
    wrong_info: "Wrong info",
    inappropriate: "Inappropriate content",
    other: "Something else",
  };
  const USER_REASON_LABELS = {
    abusive: "Abusive behavior",
    fraud: "Suspected fraud",
    no_show: "No-show / wasted offer",
    inappropriate: "Inappropriate behavior",
    other: "Something else",
  };
  const STATUS_LABELS = { open: "Open", reviewed: "Reviewed", dismissed: "Dismissed" };

  function storageSource() {
    return window.localStorage.getItem(tokenKey) ? window.localStorage : window.sessionStorage;
  }

  function syncNav() {
    const hasToken = Boolean(storageSource().getItem(tokenKey));
    if (loginLink) loginLink.hidden = hasToken;
    if (signOutButton) signOutButton.hidden = !hasToken;
  }

  function clearSession() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      storage.removeItem(tokenKey);
      storage.removeItem(refreshTokenKey);
      storage.removeItem(expiresAtKey);
    }
    syncNav();
  }

  function storeSession(session, storage) {
    storage.setItem(tokenKey, session.access_token);
    if (session.refresh_token) storage.setItem(refreshTokenKey, session.refresh_token);
    if (session.expires_in) storage.setItem(expiresAtKey, String(Date.now() + Number(session.expires_in) * 1000));
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function refreshSession(refreshToken, storage) {
    const response = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok || !payload.session?.access_token) throw new Error("Session refresh failed.");
    storeSession(payload.session, storage);
    return payload.session.access_token;
  }

  async function getToken() {
    const storage = storageSource();
    const token = storage.getItem(tokenKey);
    const refreshToken = storage.getItem(refreshTokenKey);
    const expiresAt = Number(storage.getItem(expiresAtKey) || "0");
    if (!token) return null;
    if (!refreshToken || !authEndpoint) return token;
    if (expiresAt && expiresAt - Date.now() > 60000) return token;
    return refreshSession(refreshToken, storage);
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function setReportsStatus(message, tone = "info") {
    if (!reportsStatusEl) return;
    reportsStatusEl.textContent = message;
    reportsStatusEl.className = `status${tone === "danger" ? " error" : ""}`;
  }

  async function adminPost(body) {
    const token = await getToken();
    if (!token) throw new Error("Admin session not connected.");
    const response = await fetch(reportsEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error(payload.error || "Admin session expired.");
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function addCell(row, label, text) {
    const td = document.createElement("td");
    td.dataset.label = label;
    td.textContent = text == null ? "" : String(text);
    row.appendChild(td);
    return td;
  }

  function actionButtons(reportType, report, reload) {
    const cell = document.createElement("td");
    cell.dataset.label = "Actions";
    if (report.status !== "reviewed") {
      const reviewed = document.createElement("button");
      reviewed.type = "button";
      reviewed.className = "button button-small";
      reviewed.textContent = "Mark reviewed";
      reviewed.addEventListener("click", () => changeStatus(reportType, report.id, "reviewed", reload));
      cell.appendChild(reviewed);
    }
    if (report.status !== "dismissed") {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "button button-small button-secondary";
      dismiss.textContent = "Dismiss";
      dismiss.addEventListener("click", () => changeStatus(reportType, report.id, "dismissed", reload));
      cell.appendChild(dismiss);
    }
    if (report.status !== "open") {
      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.className = "button button-small button-secondary";
      reopen.textContent = "Reopen";
      reopen.addEventListener("click", () => changeStatus(reportType, report.id, "open", reload));
      cell.appendChild(reopen);
    }
    return cell;
  }

  function emptyRow(colSpan, text) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colSpan;
    td.className = "admin-row-detail";
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  }

  function renderBusinessReports(reports, reload) {
    if (!businessBody) return;
    businessBody.innerHTML = "";
    if (!reports.length) {
      businessBody.appendChild(emptyRow(7, "No business or offer reports."));
      return;
    }
    for (const report of reports) {
      const tr = document.createElement("tr");
      addCell(tr, "Business", report.business_name || report.business_id || "");
      addCell(tr, "Offer", report.deal_title || (report.deal_id ? "(offer)" : "—"));
      addCell(tr, "Reason", BUSINESS_REASON_LABELS[report.reason] || report.reason || "");
      addCell(tr, "Details", report.comment || "");
      addCell(tr, "Status", STATUS_LABELS[report.status] || report.status || "");
      addCell(tr, "Reported", formatDateTime(report.created_at));
      tr.appendChild(actionButtons("business", report, reload));
      businessBody.appendChild(tr);
    }
  }

  function renderUserReports(reports, reload) {
    if (!userBody) return;
    userBody.innerHTML = "";
    if (!reports.length) {
      userBody.appendChild(emptyRow(6, "No customer reports."));
      return;
    }
    for (const report of reports) {
      const tr = document.createElement("tr");
      addCell(tr, "Reported by", report.reporter_business_name || report.reporter_business_id || "");
      addCell(tr, "Reason", USER_REASON_LABELS[report.reason] || report.reason || "");
      addCell(tr, "Details", report.comment || "");
      addCell(tr, "Status", STATUS_LABELS[report.status] || report.status || "");
      addCell(tr, "Reported", formatDateTime(report.created_at));
      tr.appendChild(actionButtons("user", report, reload));
      userBody.appendChild(tr);
    }
  }

  async function loadReports() {
    setReportsStatus("Loading reports…");
    const payload = await adminPost({ action: "list" });
    const businessReports = payload.business_reports || [];
    const userReports = payload.user_reports || [];
    renderBusinessReports(businessReports, loadReports);
    renderUserReports(userReports, loadReports);
    const openCount =
      businessReports.filter((r) => r.status === "open").length +
      userReports.filter((r) => r.status === "open").length;
    setStatus(openCount > 0 ? `${openCount} open report${openCount === 1 ? "" : "s"}` : "No open reports");
    setReportsStatus(
      `${businessReports.length} business/offer report${businessReports.length === 1 ? "" : "s"}, ` +
        `${userReports.length} customer report${userReports.length === 1 ? "" : "s"} loaded.`,
    );
  }

  async function changeStatus(reportType, reportId, status, reload) {
    setReportsStatus("Updating…");
    try {
      await adminPost({ action: "set_status", report_type: reportType, report_id: reportId, status });
      await reload();
    } catch (error) {
      setReportsStatus(error instanceof Error ? error.message : "Could not update report.", "danger");
    }
  }

  document.querySelector("[data-refresh-reports]")?.addEventListener("click", () => {
    loadReports().catch((error) => setReportsStatus(error instanceof Error ? error.message : "Could not load reports.", "danger"));
  });

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  syncNav();
  loadReports().catch((error) => {
    setStatus(error instanceof Error ? error.message : "Could not load reports.", "danger");
    setReportsStatus("Sign in to load reports.");
  });
})();
