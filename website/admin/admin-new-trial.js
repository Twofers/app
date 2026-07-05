(() => {
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const applicationsEndpoint = document.body.dataset.adminBusinessApplicationsEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const form = document.querySelector("[data-new-trial-form]");
  const statusEl = document.querySelector("[data-form-status]");
  const submitButton = document.querySelector("[data-new-trial-submit]");
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
    storage.setItem(tokenKey, payload.session.access_token);
    if (payload.session.refresh_token) storage.setItem(refreshTokenKey, payload.session.refresh_token);
    if (payload.session.expires_in) {
      storage.setItem(expiresAtKey, String(Date.now() + Number(payload.session.expires_in) * 1000));
    }
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
    statusEl.className = `status${tone === "danger" ? " error" : ""}`;
  }

  async function submitTrial(event) {
    event.preventDefault();
    if (!applicationsEndpoint) {
      setStatus("Admin endpoint is not configured on this page.", "danger");
      return;
    }
    const token = await getAccessToken();
    if (!token) {
      setStatus("Sign in as an admin first.", "danger");
      return;
    }

    const data = new FormData(form);
    const fields = {
      business_name: String(data.get("business_name") || "").trim(),
      contact_name: String(data.get("contact_name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      address: String(data.get("address") || "").trim(),
      business_type: String(data.get("business_type") || "").trim(),
      launch_area: String(data.get("launch_area") || "").trim(),
    };
    if (!fields.business_name || !fields.contact_name || !fields.email) {
      setStatus("Business name, contact name, and email are required.", "danger");
      return;
    }

    if (submitButton) submitButton.disabled = true;
    setStatus("Creating trial...");
    try {
      const response = await fetch(applicationsEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "create",
          decision: String(data.get("access_level") || "approve_limited"),
          reason: String(data.get("notes") || "").trim(),
          fields,
        }),
      });
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        clearSession();
        setStatus(payload.error || "Admin session expired. Sign in again.", "danger");
        return;
      }
      if (!response.ok || !payload.ok) {
        const message = payload.error || "Could not create the trial.";
        setStatus(payload.request_id ? `${message} Request id: ${payload.request_id}.` : message, "danger");
        return;
      }
      const linked = payload.business_linked
        ? "Business record is linked and ready."
        : "Saved. The business record links automatically when the owner signs in to the app with this email.";
      const billingWarning = payload.billing_sync_warning ? ` ${payload.billing_sync_warning}` : "";
      setStatus(`Trial created for ${fields.business_name}. ${linked}${billingWarning}`);
      form.reset();
    } catch {
      setStatus("Could not reach the admin service. Check that admin-business-applications is deployed.", "danger");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  if (form) form.addEventListener("submit", submitTrial);
  syncNavForSession();
})();
