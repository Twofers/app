(() => {
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const summaryEndpoint = document.body.dataset.adminSummaryEndpoint;
  const section = document.body.dataset.adminSection;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");

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

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function fillTable(selector, rows, columns, emptyText) {
    const tbody = document.querySelector(selector);
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length;
      td.className = "admin-row-detail";
      td.textContent = emptyText;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const column of columns) {
        const td = document.createElement("td");
        td.dataset.label = column.label;
        const value = column.value(row);
        if (value && typeof value === "object" && value.href) {
          const link = document.createElement("a");
          link.href = value.href;
          link.textContent = value.text;
          td.appendChild(link);
        } else {
          td.textContent = String(value ?? "");
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function detailBusinessId() {
    const fromQuery = new URLSearchParams(window.location.search).get("businessId");
    if (fromQuery) return fromQuery;
    const segments = window.location.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    return /^[0-9a-f-]{36}$/i.test(last) ? last : "";
  }

  function renderSection(payload) {
    if (section === "businesses") {
      fillTable("[data-rows]", payload.businesses || [], [
        { label: "Business", value: (r) => r.name || r.id },
        { label: "Owner", value: (r) => r.owner_email || "" },
        { label: "Status", value: (r) => r.status || "" },
        { label: "Access", value: (r) => r.access_level || "" },
        { label: "Verification", value: (r) => r.verification_status || "" },
        { label: "Risk", value: (r) => r.risk_level || "" },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
        { label: "Actions", value: (r) => ({ href: `/admin/businesses/${r.id}`, text: "Manage" }) },
      ], "No businesses yet.");
      return;
    }
    if (section === "offers") {
      fillTable("[data-rows]", payload.offers || [], [
        { label: "Offer", value: (r) => r.title || r.id },
        { label: "Business", value: (r) => r.business_name || r.business_id || "" },
        { label: "Status", value: (r) => (r.is_active ? "Live" : "Inactive") },
        { label: "Starts", value: (r) => formatDateTime(r.start_time) },
        { label: "Ends", value: (r) => formatDateTime(r.end_time) },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ], "No offers yet.");
      return;
    }
    if (section === "billing_events") {
      fillTable("[data-rows]", payload.billing_events || [], [
        { label: "Event", value: (r) => r.event_type || "" },
        { label: "Provider", value: (r) => r.provider || "" },
        { label: "Status", value: (r) => r.processing_status || "" },
        { label: "Received", value: (r) => formatDateTime(r.received_at) },
        { label: "Processed", value: (r) => formatDateTime(r.processed_at) },
        { label: "Error", value: (r) => r.error_message || "" },
      ], "No billing events yet.");
      return;
    }
    if (section === "audit_log") {
      fillTable("[data-rows]", payload.audit_log || [], [
        { label: "Admin", value: (r) => r.admin_email || "" },
        { label: "Action", value: (r) => r.action || "" },
        { label: "Target", value: (r) => r.target_type || "" },
        { label: "Business", value: (r) => r.business_id || "" },
        { label: "Reason", value: (r) => r.reason || "" },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ], "No audit events yet.");
      return;
    }
    if (section === "settings") {
      fillTable("[data-launch-areas]", payload.launch_areas || [], [
        { label: "Area", value: (r) => r.name || "" },
        { label: "City", value: (r) => [r.city, r.state].filter(Boolean).join(", ") },
        { label: "Status", value: (r) => r.status || "" },
        { label: "Timezone", value: (r) => r.timezone || "" },
      ], "No launch areas configured.");
      fillTable("[data-feature-flags]", payload.feature_flags || [], [
        { label: "Flag", value: (r) => r.key || "" },
        { label: "Description", value: (r) => r.description || "" },
        { label: "Enabled", value: (r) => (r.enabled ? "On" : "Off") },
        { label: "Updated", value: (r) => formatDateTime(r.updated_at) },
      ], "No feature flags configured.");
      fillTable("[data-admin-users]", payload.admin_users || [], [
        { label: "Email", value: (r) => r.email || "" },
        { label: "Role", value: (r) => r.role || "" },
        { label: "Active", value: (r) => (r.is_active ? "Yes" : "No") },
        { label: "MFA", value: (r) => (r.require_mfa ? "Required" : "Optional") },
        { label: "Last login", value: (r) => formatDateTime(r.last_admin_login_at) },
      ], payload.admin_users_visible === false
        ? "Admin user management is visible to owner/admin roles only."
        : "No admin users found.");
      return;
    }
    if (section === "business_detail") {
      const business = payload.business;
      const nameEl = document.querySelector("[data-business-name]");
      const metaEl = document.querySelector("[data-business-meta]");
      if (nameEl) nameEl.textContent = business ? business.name || business.id : "Business not found";
      if (metaEl) {
        metaEl.textContent = business
          ? `Status ${business.status || "unknown"} | Access ${business.access_level || "unknown"} | Verification ${business.verification_status || "unknown"} | Risk ${business.risk_level || "unknown"}`
          : "Check the link from the Businesses page and try again.";
      }
      fillTable("[data-applications]", payload.applications || [], [
        { label: "Contact", value: (r) => r.contact_name || "" },
        { label: "Email", value: (r) => r.email || "" },
        { label: "Status", value: (r) => r.status || "" },
        { label: "Access", value: (r) => r.access_tier || "" },
        { label: "Trial days", value: (r) => r.trial_days ?? "" },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ], "No applications linked to this business.");
      fillTable("[data-audit]", payload.audit_log || [], [
        { label: "Admin", value: (r) => r.admin_email || "" },
        { label: "Action", value: (r) => r.action || "" },
        { label: "Reason", value: (r) => r.reason || "" },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ], "No audit events for this business.");
    }
  }

  async function loadSection() {
    if (!summaryEndpoint || !section) return;
    const token = await getAccessToken();
    if (!token) {
      setStatus("Admin session not connected", "warning");
      return;
    }

    setStatus("Loading...");
    const body = { section };
    if (section === "business_detail") body.business_id = detailBusinessId();

    try {
      const response = await fetch(summaryEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        clearSession();
        setStatus("Admin session expired. Sign in again.", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed");
      setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
      renderSection(payload);
    } catch {
      setStatus("Could not load this page", "danger");
    }
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  syncNavForSession();
  loadSection();
})();
