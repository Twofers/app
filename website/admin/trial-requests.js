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
  // Keep in step with the <thead> in this page's index.html.
  const COLUMN_COUNT = 8;
  // Business name per application id, so a confirm can name what it is about to change.
  const businessNames = new Map();

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

  // Mirrors riskLevel() in supabase/functions/admin-business-applications/index.ts.
  // The scale is inverted on purpose: it is a trust score, so a LOWER number means
  // HIGHER risk. Showing the bare number reads backwards, hence the label.
  function riskLevelFor(score) {
    if (score === null || score === undefined || score === "") return null;
    const value = Number(score);
    if (!Number.isFinite(value)) return null;
    if (value < 0) return { label: "Blocked", tone: "danger" };
    if (value >= 70) return { label: "Low", tone: "success" };
    if (value >= HIGH_RISK_MAX_SCORE + 1) return { label: "Medium", tone: "warning" };
    return { label: "High", tone: "danger" };
  }

  // Same wording as the dashboard action queue (relativeWaiting in admin.js) so the
  // two triage surfaces read the same way.
  function relativeAge(value) {
    if (!value) return "";
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "";
    const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
    if (days === 0) return "Today";
    if (days === 1) return "1 day";
    return `${days} days`;
  }

  function fullTimestamp(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function businessNameFor(applicationId) {
    return businessNames.get(applicationId) || "this business";
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
    td.colSpan = COLUMN_COUNT;
    td.className = "admin-row-detail";
    td.textContent = message;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // Placeholder rows while the queue loads, so a stale decision is never left on
  // screen looking current. Mirrors setTablesState("loading") in admin-directory.js.
  function renderLoadingRows() {
    if (!tbody) return;
    tbody.innerHTML = "";
    const headers = [...document.querySelectorAll(".admin-access-table thead th")];
    for (let row = 0; row < 4; row += 1) {
      const tr = document.createElement("tr");
      tr.setAttribute("aria-hidden", "true");
      for (let column = 0; column < COLUMN_COUNT; column += 1) {
        const td = document.createElement("td");
        if (headers[column]) td.dataset.label = headers[column].textContent || "";
        const bar = document.createElement("span");
        bar.className = "admin-skeleton";
        td.appendChild(bar);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function actionButton(app, { decision, adminAction, label, ariaLabel, variant }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button button-small${variant ? ` ${variant}` : ""}`;
    if (decision) button.dataset.decision = decision;
    if (adminAction) button.dataset.adminAction = adminAction;
    button.dataset.applicationId = app.id;
    button.textContent = label;
    // Every row repeats the same button labels, so name the business for screen readers.
    button.setAttribute("aria-label", `${ariaLabel} ${app.business_name || "this business"}`);
    return button;
  }

  function renderApplications(applications) {
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!applications.length) {
      renderEmpty("No business access requests found for this queue.");
      return;
    }

    for (const app of applications) {
      businessNames.set(app.id, app.business_name || "");
      const tr = document.createElement("tr");
      const status = app.status || "unknown";
      const tone = badgeTone(status);
      const cells = [
        ["Business", app.business_name || "Unknown business", ""],
        ["Owner", app.contact_name || "", ""],
        ["Email", app.email || "", "admin-access-email"],
        ["Launch area", app.launch_area || "Unspecified", ""],
      ];

      for (const [label, value, className] of cells) {
        const td = document.createElement("td");
        td.dataset.label = label;
        if (className) td.className = className;
        td.textContent = escapeText(value);
        tr.appendChild(td);
      }

      // How long this request has been waiting. The queue is unusable for triage
      // without it, and created_at is already in the list payload.
      const requestedTd = document.createElement("td");
      requestedTd.dataset.label = "Requested";
      requestedTd.textContent = relativeAge(app.created_at) || "—";
      const requestedTitle = fullTimestamp(app.created_at);
      if (requestedTitle) requestedTd.title = `Requested ${requestedTitle}`;
      tr.appendChild(requestedTd);

      // The raw score reads backwards on its own -- 5 looks safe but means high
      // risk -- so lead with the level and keep the number as supporting detail.
      const riskTd = document.createElement("td");
      riskTd.dataset.label = "Risk";
      const risk = riskLevelFor(app.risk_score);
      const riskBadge = document.createElement("span");
      riskBadge.className = `admin-badge${risk ? ` ${risk.tone}` : ""}`;
      riskBadge.textContent = risk ? `${risk.label} · ${app.risk_score}` : "Unscored";
      riskBadge.title = risk
        ? `Risk score ${app.risk_score} of 100 — a lower score means higher risk.`
        : "No risk score recorded for this request.";
      riskTd.appendChild(riskBadge);
      tr.appendChild(riskTd);

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
      // Only the two everyday actions stay in the open. The rest -- including
      // everything destructive or free-of-charge -- sits behind a disclosure so a
      // wrapped row cannot put Reject under the cursor you aimed at Approve.
      actions.append(
        actionButton(app, { decision: "approve_setup", label: "Approve for setup", ariaLabel: "Approve for setup:" }),
        actionButton(app, { decision: "ai_review", label: "AI review", ariaLabel: "Draft an AI review for", variant: "button-secondary" }),
      );

      const moreActions = document.createElement("details");
      moreActions.className = "admin-more-actions";
      const moreSummary = document.createElement("summary");
      moreSummary.textContent = "More actions";
      moreSummary.setAttribute("aria-label", `More actions for ${app.business_name || "this business"}`);
      const moreList = document.createElement("div");
      moreList.className = "admin-inline-actions";

      // Full access without payment: a day count plus its own button, boxed
      // together so the number always belongs to the row being approved.
      const grant = document.createElement("div");
      grant.className = "admin-trial-grant";
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
      daysInput.setAttribute("aria-label", `Trial days for ${app.business_name || "this business"}`);
      daysLabel.appendChild(daysInput);
      grant.append(
        daysLabel,
        actionButton(app, { decision: "approve_full_access", label: "Approve - full access", ariaLabel: "Approve full access for" }),
      );
      moreList.appendChild(grant);

      moreList.append(
        actionButton(app, { decision: "review_required", label: "Review", ariaLabel: "Mark review required for", variant: "button-secondary" }),
        actionButton(app, { decision: "waitlist", label: "Waitlist", ariaLabel: "Waitlist", variant: "button-secondary" }),
        actionButton(app, { decision: "reject", label: "Reject", ariaLabel: "Reject the request from", variant: "button-secondary button-danger" }),
        actionButton(app, { decision: "suspend", label: "Suspend", ariaLabel: "Suspend", variant: "button-secondary button-danger" }),
      );

      if (app.billing_link_resend_eligible === true) {
        moreList.appendChild(actionButton(app, {
          adminAction: "resend_billing_link",
          label: app.billing_link_email_sent ? "Send new billing link" : "Send billing link",
          ariaLabel: "Send a billing link to",
          variant: "button-secondary",
        }));
      }

      moreActions.append(moreSummary, moreList);
      actions.appendChild(moreActions);
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);

      const detailTr = document.createElement("tr");
      const detailTd = document.createElement("td");
      detailTd.colSpan = COLUMN_COUNT;
      detailTd.className = "admin-row-detail";
      // The facts live in their own node so an AI review can be appended beside
      // them instead of overwriting the evidence the decision rests on.
      const facts = document.createElement("p");
      facts.className = "admin-note";
      facts.dataset.applicationFacts = app.id;
      facts.textContent = [
        app.business_type ? `Type: ${app.business_type}` : "",
        app.phone ? `Phone: ${app.phone}` : "",
        app.website_or_instagram ? `Web/IG: ${app.website_or_instagram}` : "",
        app.address ? `Address: ${app.address}` : "",
        app.slow_hours ? `Slow hours: ${app.slow_hours}` : "",
        app.offer_interests ? `Offers: ${app.offer_interests}` : "",
        Array.isArray(app.risk_reasons) && app.risk_reasons.length ? `Signals: ${app.risk_reasons.join(", ")}` : "",
      ].filter(Boolean).join(" | ") || "No extra request details.";
      detailTd.appendChild(facts);
      detailTd.dataset.applicationDetail = app.id;
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);
    }
  }

  async function loadApplications({ showSkeleton = false } = {}) {
    setTrialStatus("Loading business access requests...");
    if (showSkeleton) renderLoadingRows();
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
        if (detail) {
          // Replace only a previous draft; the request facts above it stay put.
          detail.querySelector(`[data-application-ai="${applicationId}"]`)?.remove();
          const block = document.createElement("div");
          block.className = "admin-ai-review";
          block.dataset.applicationAi = applicationId;
          const heading = document.createElement("p");
          heading.className = "admin-ai-review-heading";
          heading.textContent = "AI review — draft only, not a decision";
          const body = document.createElement("p");
          body.className = "admin-ai-review-body";
          body.textContent = stringifyRecommendation(payload.recommendation) || "The AI review came back empty.";
          block.append(heading, body);
          detail.appendChild(block);
        }
        setTrialStatus("AI review drafted. Admin decision still requires an explicit click.");
      } finally {
        button.disabled = false;
      }
      return;
    }
    // Every confirm names the business: the rows repeat the same button labels, so
    // "are you sure?" on its own does not tell you which row you hit.
    const name = businessNameFor(applicationId);
    if (decision === "reject" && !window.confirm(`Reject the request from ${name}? They will be told the request was declined.`)) return;
    if (decision === "approve_setup" && !window.confirm(`Approve ${name} for setup access? No trial, credits, or publishing start yet.`)) return;
    if (decision === "waitlist" && !window.confirm(`Move ${name} to the waitlist?`)) return;
    if (decision === "suspend" && !window.confirm(`Suspend ${name} and block all merchant actions?`)) return;

    let trialDays;
    if (decision === "approve_full_access") {
      trialDays = trialDaysFor(applicationId);
      if (trialDays === null) {
        setTrialStatus(`Enter a whole number of trial days between ${MIN_TRIAL_DAYS} and ${MAX_TRIAL_DAYS}.`, "warning");
        return;
      }
      const confirmed = window.confirm(
        `Grant ${name} ${trialDays} days of full access now? No payment required yet.`,
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

  function reloadQueue() {
    loadApplications({ showSkeleton: true }).catch((error) => {
      if (String(error?.message || "").includes("session")) setAdminStatus("Admin session not connected", "warning");
      renderEmpty("Could not load business access requests.");
      setTrialStatus(error instanceof Error ? error.message : "Could not load business access requests.", "danger");
    });
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      reloadQueue();
    });
    // Changing the queue reloads immediately; Load requests stays as an explicit refresh.
    form.querySelector('select[name="status"]')?.addEventListener("change", reloadQueue);
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
