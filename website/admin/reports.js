(() => {
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const reportsEndpoint = document.body.dataset.adminReportsEndpoint;
  const nameRequestsEndpoint = document.body.dataset.adminNameRequestsEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const reportsStatusEl = document.querySelector("[data-reports-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const businessBody = document.querySelector("[data-business-reports-body]");
  const userBody = document.querySelector("[data-user-reports-body]");
  const nameRequestsBody = document.querySelector("[data-name-requests-body]");
  const nameRequestsStatusEl = document.querySelector("[data-name-requests-status]");

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

  async function adminPostTo(endpoint, body) {
    const token = await getToken();
    if (!token) throw new Error("Admin session not connected.");
    const response = await fetch(endpoint, {
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

  function adminPost(body) {
    return adminPostTo(reportsEndpoint, body);
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

  function setNameRequestsStatus(message, tone = "info") {
    if (!nameRequestsStatusEl) return;
    nameRequestsStatusEl.textContent = message;
    nameRequestsStatusEl.className = `status${tone === "danger" ? " error" : ""}`;
  }

  const NAME_REQUEST_STATUS_LABELS = {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
    canceled: "Canceled",
  };

  function renderNameRequests(requests) {
    if (!nameRequestsBody) return;
    nameRequestsBody.innerHTML = "";
    if (!requests.length) {
      nameRequestsBody.appendChild(emptyRow(7, "No name change requests."));
      return;
    }
    for (const request of requests) {
      const tr = document.createElement("tr");
      addCell(tr, "Business", request.business_name || request.business_id || "");
      addCell(tr, "Current name", request.current_value || request.business_name || "");
      addCell(tr, "Requested name", request.proposed_value || "");
      addCell(tr, "Reason", request.reason || "");
      addCell(tr, "Status", NAME_REQUEST_STATUS_LABELS[request.status] || request.status || "");
      addCell(tr, "Requested", formatDateTime(request.created_at));
      const cell = document.createElement("td");
      cell.dataset.label = "Actions";
      if (request.status === "pending") {
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "button button-small";
        approve.textContent = "Approve";
        approve.addEventListener("click", () => decideNameRequest(request, "approve"));
        cell.appendChild(approve);
        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "button button-small button-secondary";
        reject.textContent = "Reject";
        reject.addEventListener("click", () => decideNameRequest(request, "reject"));
        cell.appendChild(reject);
      }
      tr.appendChild(cell);
      nameRequestsBody.appendChild(tr);
    }
  }

  async function decideNameRequest(request, action) {
    if (action === "approve") {
      const confirmed = window.confirm(
        `Rename "${request.business_name || request.current_value || ""}" to "${request.proposed_value}"?\n\n` +
          "This changes the name everywhere customers see it. Approve only if it's the same real business.",
      );
      if (!confirmed) return;
    }
    const decisionReason = window.prompt(
      action === "approve" ? "Optional note for the audit log:" : "Why is this request rejected?",
      "",
    );
    if (decisionReason === null && action === "reject") return;
    setNameRequestsStatus("Updating…");
    try {
      await adminPostTo(nameRequestsEndpoint, {
        action,
        request_id: request.id,
        decision_reason: decisionReason || null,
      });
      await loadNameRequests();
    } catch (error) {
      setNameRequestsStatus(error instanceof Error ? error.message : "Could not update the request.", "danger");
    }
  }

  async function loadNameRequests() {
    if (!nameRequestsEndpoint || !nameRequestsBody) return;
    setNameRequestsStatus("Loading name change requests…");
    try {
      const payload = await adminPostTo(nameRequestsEndpoint, { action: "list" });
      const requests = payload.requests || [];
      renderNameRequests(requests);
      const pendingCount = requests.filter((r) => r.status === "pending").length;
      setNameRequestsStatus(
        pendingCount > 0
          ? `${pendingCount} pending request${pendingCount === 1 ? "" : "s"}.`
          : `${requests.length} request${requests.length === 1 ? "" : "s"} loaded, none pending.`,
      );
    } catch (error) {
      // Keep the reports tables usable even if this function isn't deployed yet.
      setNameRequestsStatus(error instanceof Error ? error.message : "Could not load name change requests.", "danger");
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
    void loadNameRequests();
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
  void loadNameRequests();
})();
