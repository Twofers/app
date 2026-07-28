(() => {
  const Shell = window.TwoferAdminShell;
  const applicationsEndpoint = Shell.endpoint("admin-business-applications");
  const onboardingReviewAiEndpoint = Shell.endpoint("admin-onboarding-review-ai");
  const statusEl = document.querySelector("[data-admin-status]");
  const trialStatus = document.querySelector("[data-trial-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const form = document.querySelector("[data-trial-filter-form]");
  const tbody = document.querySelector("[data-trial-requests-body]");
  // Dashboard triage links pass ?status= and ?risk=high; honor them on load.
  const urlParams = new URLSearchParams(window.location.search);
  const highRiskOnly = urlParams.get("risk") === "high";
  const HIGH_RISK_MAX_SCORE = 39; // Mirrors admin-dashboard-summary's high-risk definition.
  // Mirrors the business_applications.trial_days CHECK and the same bounds in
  // admin-business-applications; keep all three in step.
  const MIN_TRIAL_DAYS = 1;
  const MAX_TRIAL_DAYS = 120;
  const DEFAULT_TRIAL_DAYS = 30;

  function applyRequestedQueue() {
    if (!form) return;
    const requested = String(urlParams.get("status") || "").trim();
    if (!requested) return;
    const select = form.querySelector('select[name="status"]');
    if (!select) return;
    if ([...select.options].some((option) => option.value === requested)) select.value = requested;
  }

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
      if (action === "decide") return "The approval decision request timed out. Refresh the queue before trying that decision again.";
      if (action === "resend") return "The billing-link email request timed out. Refresh the queue before trying again.";
      return "The business access request queue timed out. Refresh this page and try again.";
    }
    if (action === "session") return "Could not refresh the admin session. Sign in again if this continues.";
    if (action === "decide") return "Could not reach the approval decision service. Refresh the queue before trying that decision again.";
    if (action === "resend") return "Could not reach the billing-link email service. Refresh the queue before trying again.";
    return "Could not reach the business access request service. Refresh this page and try again.";
  }

  function badgeTone(status) {
    if (status === "rejected") return "danger";
    if (status === "waitlisted" || status === "pending_review" || status === "review_required") return "warning";
    return "info";
  }

  function statusLabel(status) {
    if (status === "approved_not_activated") return "approved setup";
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

  // Mirrors the server bound (business_applications.trial_days CHECK 1..120) so
  // a bad number is caught before it costs a round trip.
  function trialDaysFor(applicationId) {
    const input = document.querySelector(`[data-trial-days-for="${applicationId}"]`);
    if (!input) return null;
    const raw = String(input.value || "").trim();
    if (!/^\d+$/.test(raw)) return null;
    const days = Number(raw);
    if (!Number.isInteger(days) || days < MIN_TRIAL_DAYS || days > MAX_TRIAL_DAYS) return null;
    return days;
  }

  function selectedStatus() {
    if (!form) return "open";
    const data = new FormData(form);
    return String(data.get("status") || "open");
  }

  async function postAdmin(body) {
    if (!applicationsEndpoint) throw new Error("Business access request endpoint is not configured.");
    const token = await getAccessToken();
    if (!token) throw new Error("Admin session not connected.");
    const action = body?.action === "decide"
      ? "decide"
      : body?.action === "resend_billing_link"
      ? "resend"
      : "list";
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
    if (!response.ok || !payload.ok) {
      const message = payload.error || "Request failed.";
      throw new Error(payload.request_id ? `${message} Request id: ${payload.request_id}.` : message);
    }
    return payload;
  }

  async function postOnboardingAi(body) {
    if (!onboardingReviewAiEndpoint) throw new Error("Onboarding AI review endpoint is not configured.");
    const token = await getAccessToken();
    if (!token) throw new Error("Admin session not connected.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25000);
    let response;
    try {
      response = await fetch(onboardingReviewAiEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(networkFailureMessage("review", error));
    } finally {
      window.clearTimeout(timeout);
    }
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error(response.status === 401 ? "Admin session expired. Sign in again." : payload.error || "Forbidden.");
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || "AI review request failed.");
    return payload;
  }

  function stringifyRecommendation(value) {
    if (!value || typeof value !== "object") return "";
    return [
      value.application_summary,
      value.recommended_approval_path ? `Recommended path: ${value.recommended_approval_path}` : "",
      Array.isArray(value.missing_fields) && value.missing_fields.length ? `Missing: ${value.missing_fields.join(", ")}` : "",
      Array.isArray(value.risk_flags) && value.risk_flags.length ? `Risk flags: ${value.risk_flags.join(", ")}` : "",
      value.possible_duplicate_business ? `Duplicate check: ${value.possible_duplicate_business}` : "",
      value.suggested_admin_note ? `Admin note: ${value.suggested_admin_note}` : "",
      value.suggested_next_email ? `Next email: ${value.suggested_next_email}` : "",
      value.suggested_follow_up ? `Follow-up: ${value.suggested_follow_up}` : "",
    ].filter(Boolean).join("\n");
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
      renderEmpty("No business access requests found for this queue.");
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
        ["ai_review", "AI Review"],
        ["approve_setup", "Approve for setup"],
        ["review_required", "Review"],
        ["waitlist", "Waitlist"],
        ["reject", "Reject"],
        ["suspend", "Suspend"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `button button-small${decision === "reject" || decision === "suspend" ? " button-secondary" : ""}`;
        button.dataset.decision = decision;
        button.dataset.applicationId = app.id;
        button.textContent = label;
        actions.appendChild(button);
      }

      // Full access without payment: a day count plus its own button, kept next
      // to each other so the number always belongs to the row being approved.
      const daysLabel = document.createElement("label");
      daysLabel.className = "admin-inline-field";
      daysLabel.textContent = "Trial days";
      const daysInput = document.createElement("input");
      daysInput.type = "number";
      daysInput.min = String(MIN_TRIAL_DAYS);
      daysInput.max = String(MAX_TRIAL_DAYS);
      daysInput.step = "1";
      daysInput.value = String(DEFAULT_TRIAL_DAYS);
      daysInput.dataset.trialDaysFor = app.id;
      daysLabel.appendChild(daysInput);
      actions.appendChild(daysLabel);

      const fullAccessButton = document.createElement("button");
      fullAccessButton.type = "button";
      fullAccessButton.className = "button button-small";
      fullAccessButton.dataset.decision = "approve_full_access";
      fullAccessButton.dataset.applicationId = app.id;
      fullAccessButton.textContent = "Approve - full access";
      actions.appendChild(fullAccessButton);

      if (app.billing_link_resend_eligible === true) {
        const resendButton = document.createElement("button");
        resendButton.type = "button";
        resendButton.className = "button button-small button-secondary";
        resendButton.dataset.adminAction = "resend_billing_link";
        resendButton.dataset.applicationId = app.id;
        resendButton.textContent = app.billing_link_email_sent
          ? "Send new billing link"
          : "Send billing link";
        actions.appendChild(resendButton);
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
        app.phone ? `Phone: ${app.phone}` : "",
        app.website_or_instagram ? `Web/IG: ${app.website_or_instagram}` : "",
        app.address ? `Address: ${app.address}` : "",
        app.slow_hours ? `Slow hours: ${app.slow_hours}` : "",
        app.offer_interests ? `Offers: ${app.offer_interests}` : "",
        Array.isArray(app.risk_reasons) && app.risk_reasons.length ? `Signals: ${app.risk_reasons.join(", ")}` : "",
      ].filter(Boolean).join(" | ") || "No extra request details.";
      detailTd.dataset.applicationDetail = app.id;
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);
    }
  }

  async function loadApplications() {
    setTrialStatus("Loading business access requests...");
    const payload = await postAdmin({ action: "list", status: selectedStatus() });
    let applications = payload.applications || [];
    if (highRiskOnly) {
      applications = applications.filter((app) => {
        const score = Number(app.risk_score);
        return Number.isFinite(score) && score <= HIGH_RISK_MAX_SCORE;
      });
    }
    renderApplications(applications);
    setAdminStatus("Signed in");
    setTrialStatus(
      highRiskOnly
        ? `Loaded ${applications.length} high-risk request(s) (risk score ${HIGH_RISK_MAX_SCORE} or lower).`
        : `Loaded ${applications.length} request(s).`,
    );
  }

  async function decide(applicationId, decision, button) {
    if (decision === "ai_review") {
      button.disabled = true;
      setTrialStatus("Generating onboarding review...");
      try {
        const payload = await postOnboardingAi({ application_id: applicationId });
        const detail = document.querySelector(`[data-application-detail="${applicationId}"]`);
        if (detail) detail.textContent = stringifyRecommendation(payload.recommendation);
        setTrialStatus("AI review drafted. Admin decision still requires an explicit click.");
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (decision === "reject" && !window.confirm("Reject this business request?")) return;
    if (decision === "approve_setup" && !window.confirm("Approve this business for setup access? No trial or credits start yet.")) return;
    if (decision === "suspend" && !window.confirm("Suspend this business and block merchant actions?")) return;

    let trialDays;
    if (decision === "approve_full_access") {
      trialDays = trialDaysFor(applicationId);
      if (trialDays === null) {
        setTrialStatus(`Enter a whole number of trial days between ${MIN_TRIAL_DAYS} and ${MAX_TRIAL_DAYS}.`, "warning");
        return;
      }
      const confirmed = window.confirm(
        `Grant ${trialDays} days of full access now, no payment required yet?`,
      );
      if (!confirmed) return;
    }

    button.disabled = true;
    setTrialStatus("Saving decision...");
    try {
      const payload = await postAdmin({
        action: "decide",
        application_id: applicationId,
        decision,
        reason: noteValue(),
        ...(trialDays === undefined ? {} : { trial_days: trialDays }),
      });
      const savedMessage = payload.business_linked
        ? "Decision saved and linked business setup access updated."
        : "Decision saved. Business owner will link when they sign in.";
      const decisionWarnings = [payload.billing_sync_warning, payload.approval_email_warning].filter(Boolean);
      setTrialStatus(
        decisionWarnings.length ? `${savedMessage} ${decisionWarnings.join(" ")}` : savedMessage,
        decisionWarnings.length ? "warning" : "info",
      );
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

  async function resendBillingLink(applicationId, button) {
    const confirmed = window.confirm(
      "Send a new secure billing-link email? The previous email link will stop working.",
    );
    if (!confirmed) return;

    button.disabled = true;
    setTrialStatus("Sending a new billing link...");
    try {
      const payload = await postAdmin({
        action: "resend_billing_link",
        application_id: applicationId,
      });
      setTrialStatus(
        payload.message || "A new billing-link email was sent. The previous link is no longer valid.",
      );
      try {
        await loadApplications();
      } catch (error) {
        if (String(error?.message || "").includes("session")) {
          setAdminStatus("Admin session not connected", "warning");
        }
        setTrialStatus(
          "The billing-link email was sent, but the queue refresh failed. Use Load requests before sending another.",
          "warning",
        );
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
        setTrialStatus(error instanceof Error ? error.message : "Could not load business access requests.", "danger");
      });
    });
  }

  if (tbody) {
    tbody.addEventListener("click", (event) => {
      const button = event.target instanceof HTMLElement
        ? event.target.closest("button[data-decision], button[data-admin-action]")
        : null;
      if (!button) return;
      if (button.dataset.adminAction === "resend_billing_link") {
        resendBillingLink(button.dataset.applicationId || "", button).catch((error) => {
          setTrialStatus(error instanceof Error ? error.message : "Could not send a new billing link.", "danger");
        });
        return;
      }
      decide(button.dataset.applicationId || "", button.dataset.decision || "", button).catch((error) => {
        setTrialStatus(error instanceof Error ? error.message : "Could not save decision.", "danger");
      });
    });
  }

  syncNavForSession();
  applyRequestedQueue();
  loadApplications().catch((error) => {
    if (String(error?.message || "").includes("session")) setAdminStatus("Admin session not connected", "warning");
    renderEmpty("Sign in to load business access requests.");
    setTrialStatus(error instanceof Error ? error.message : "Could not load business access requests.", "danger");
  });
})();
