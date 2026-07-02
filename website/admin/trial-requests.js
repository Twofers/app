(() => {
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const applicationsEndpoint = document.body.dataset.adminBusinessApplicationsEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const trialStatus = document.querySelector("[data-trial-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const form = document.querySelector("[data-trial-filter-form]");
  const tbody = document.querySelector("[data-trial-requests-body]");

  function sessionStorageSource() {
    return window.localStorage.getItem(tokenKey) ? window.localStorage : window.sessionStorage;
  }

  function syncNavForSession() {
    const hasToken = Boolean(sessionStorageSource().getItem(tokenKey));
    if (loginLink) loginLink.hidden = hasToken;
    if (signOutButton) signOutButton.hidden = !hasToken;
  }

  function clearSession() {
    for (const storage of [window.sessionStorage, window.localStorage]) {
      storage.removeItem(tokenKey);
      storage.removeItem(refreshTokenKey);
      storage.removeItem(expiresAtKey);
    }
    syncNavForSession();
  }

  function storeSession(session, storage) {
    storage.setItem(tokenKey, session.access_token);
    if (session.refresh_token) storage.setItem(refreshTokenKey, session.refresh_token);
    if (session.expires_in) {
      storage.setItem(expiresAtKey, String(Date.now() + Number(session.expires_in) * 1000));
    }
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function refreshSession(refreshToken, storage) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(authEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(networkFailureMessage("session", error));
    } finally {
      window.clearTimeout(timeout);
    }
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error("Admin session expired. Sign in again.");
    }
    if (!response.ok || !payload.ok || !payload.session?.access_token) throw new Error("Session refresh failed.");
    storeSession(payload.session, storage);
    return payload.session.access_token;
  }

  async function getAccessToken() {
    const storage = sessionStorageSource();
    const token = storage.getItem(tokenKey);
    const refreshToken = storage.getItem(refreshTokenKey);
    const expiresAt = Number(storage.getItem(expiresAtKey) || "0");
    if (!token) return null;
    if (!refreshToken || !authEndpoint) return token;
    if (expiresAt && expiresAt - Date.now() > 60000) return token;
    return refreshSession(refreshToken, storage);
  }

  function setAdminStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function setTrialStatus(message, tone = "info") {
    if (!trialStatus) return;
    trialStatus.textContent = message;
    trialStatus.className = `status${tone === "danger" ? " error" : tone === "warning" ? " warning" : ""}`;
  }

  function networkFailureMessage(action, error) {
    if (error?.name === "AbortError") {
      if (action === "session") return "The admin session refresh timed out. Sign in again if this continues.";
      if (action === "decide") return "The trial decision request timed out. Refresh the queue before trying that decision again.";
      return "The trial request queue timed out. Refresh this page and try again.";
    }
    if (action === "session") return "Could not refresh the admin session. Sign in again if this continues.";
    if (action === "decide") return "Could not reach the trial decision service. Refresh the queue before trying that decision again.";
    return "Could not reach the trial request service. Refresh this page and try again.";
  }

  function badgeTone(status) {
    if (status === "rejected") return "danger";
    if (status === "waitlisted" || status === "pending_review" || status === "review_required") return "warning";
    return "info";
  }

  function statusLabel(status) {
    return String(status || "unknown").replaceAll("_", " ");
  }

  function escapeText(value) {
    return String(value ?? "");
  }

  function noteValue() {
    if (!form) return "";
    const data = new FormData(form);
    return String(data.get("reason") || "").trim();
  }

  function selectedStatus() {
    if (!form) return "open";
    const data = new FormData(form);
    return String(data.get("status") || "open");
  }

  async function postAdmin(body) {
    if (!applicationsEndpoint) throw new Error("Trial request endpoint is not configured.");
    const token = await getAccessToken();
    if (!token) throw new Error("Admin session not connected.");
    const action = body?.action === "decide" ? "decide" : "list";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(applicationsEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(networkFailureMessage(action, error));
    } finally {
      window.clearTimeout(timeout);
    }
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error(response.status === 401 ? "Admin session expired. Sign in again." : payload.error || "Forbidden.");
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  function renderEmpty(message) {
    if (!tbody) return;
    tbody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "admin-row-detail";
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function renderApplications(applications) {
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!applications.length) {
      renderEmpty("No trial requests found for this queue.");
      return;
    }

    for (const app of applications) {
      const tr = document.createElement("tr");
      const status = app.status || "unknown";
      const tone = badgeTone(status);
      const cells = [
        ["Business", app.business_name || "Unknown business"],
        ["Owner", app.contact_name || ""],
        ["Email", app.email || ""],
        ["Launch area", app.launch_area || "Unspecified"],
        ["Risk score", app.risk_score ?? ""],
      ];

      for (const [label, value] of cells) {
        const td = document.createElement("td");
        td.dataset.label = label;
        td.textContent = escapeText(value);
        tr.appendChild(td);
      }

      const statusTd = document.createElement("td");
      statusTd.dataset.label = "Status";
      const badge = document.createElement("span");
      badge.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
      badge.textContent = statusLabel(status);
      statusTd.appendChild(badge);
      tr.appendChild(statusTd);

      const actionsTd = document.createElement("td");
      actionsTd.dataset.label = "Action";
      const actions = document.createElement("div");
      actions.className = "admin-inline-actions";
      for (const [decision, label] of [
        ["approve_limited", "Limited"],
        ["approve_full", "Full"],
        ["waitlist", "Waitlist"],
        ["reject", "Reject"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `button button-small${decision === "reject" ? " button-secondary" : ""}`;
        button.dataset.decision = decision;
        button.dataset.applicationId = app.id;
        button.textContent = label;
        actions.appendChild(button);
      }
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);

      const detailTr = document.createElement("tr");
      const detailTd = document.createElement("td");
      detailTd.colSpan = 7;
      detailTd.className = "admin-row-detail";
      detailTd.textContent = [
        app.business_type ? `Type: ${app.business_type}` : "",
        app.address ? `Address: ${app.address}` : "",
        app.slow_hours ? `Slow hours: ${app.slow_hours}` : "",
        app.offer_interests ? `Offers: ${app.offer_interests}` : "",
        Array.isArray(app.risk_reasons) && app.risk_reasons.length ? `Signals: ${app.risk_reasons.join(", ")}` : "",
      ].filter(Boolean).join(" | ") || "No extra request details.";
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);
    }
  }

  async function loadApplications() {
    setTrialStatus("Loading trial requests...");
    const payload = await postAdmin({ action: "list", status: selectedStatus() });
    renderApplications(payload.applications || []);
    setAdminStatus("Signed in");
    setTrialStatus(`Loaded ${(payload.applications || []).length} request(s).`);
  }

  async function decide(applicationId, decision, button) {
    if (decision === "reject" && !window.confirm("Reject this business request?")) return;
    button.disabled = true;
    setTrialStatus("Saving decision...");
    try {
      const payload = await postAdmin({
        action: "decide",
        application_id: applicationId,
        decision,
        reason: noteValue(),
      });
      setTrialStatus(payload.business_linked
        ? "Decision saved and linked business access updated."
        : "Decision saved. Business owner will link when they sign in.");
      try {
        await loadApplications();
      } catch (error) {
        if (String(error?.message || "").includes("session")) setAdminStatus("Admin session not connected", "warning");
        setTrialStatus("Decision saved, but the queue refresh failed. Use Load requests before making another decision.", "warning");
      }
    } finally {
      button.disabled = false;
    }
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      loadApplications().catch((error) => {
        if (String(error?.message || "").includes("session")) setAdminStatus("Admin session not connected", "warning");
        setTrialStatus(error instanceof Error ? error.message : "Could not load trial requests.", "danger");
      });
    });
  }

  if (tbody) {
    tbody.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement ? event.target.closest("button[data-decision]") : null;
      if (!button) return;
      decide(button.dataset.applicationId || "", button.dataset.decision || "", button).catch((error) => {
        setTrialStatus(error instanceof Error ? error.message : "Could not save decision.", "danger");
      });
    });
  }

  syncNavForSession();
  loadApplications().catch((error) => {
    if (String(error?.message || "").includes("session")) setAdminStatus("Admin session not connected", "warning");
    renderEmpty("Sign in to load trial requests.");
    setTrialStatus(error instanceof Error ? error.message : "Could not load trial requests.", "danger");
  });
})();
