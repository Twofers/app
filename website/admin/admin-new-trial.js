(() => {
  const Shell = window.TwoferAdminShell;
  const applicationsEndpoint = Shell.endpoint("admin-business-applications");
  const form = document.querySelector("[data-new-trial-form]");
  const statusEl = document.querySelector("[data-form-status]");
  const submitButton = document.querySelector("[data-new-trial-submit]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");

  function syncNavForSession() {
    const hasToken = Shell.hasStoredToken();
    if (loginLink) loginLink.hidden = hasToken;
    if (signOutButton) signOutButton.hidden = !hasToken;
  }

  function clearSession() {
    Shell.clearSession();
    syncNavForSession();
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function getAccessToken() {
    return Shell.getAccessToken();
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
    setStatus("Creating setup approval...");
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
        const message = payload.error || "Could not create the setup approval.";
        setStatus(payload.request_id ? `${message} Request id: ${payload.request_id}.` : message, "danger");
        return;
      }
      const linked = payload.business_linked
        ? "Business record is linked and ready."
        : "Saved. The business record links automatically when the owner signs in to the app with this email.";
      const decisionWarnings = [payload.billing_sync_warning, payload.approval_email_warning].filter(Boolean);
      const warningSuffix = decisionWarnings.length ? ` ${decisionWarnings.join(" ")}` : "";
      setStatus(`Setup approval created for ${fields.business_name}. ${linked}${warningSuffix}`);
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
