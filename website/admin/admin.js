(() => {
  const endpoint = document.body.dataset.adminSummaryEndpoint;
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const aiUsageEndpoint = document.body.dataset.adminAiUsageEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const aiQuotaForm = document.querySelector("[data-ai-quota-form]");
  const aiQuotaStatus = document.querySelector("[data-ai-quota-status]");
  const aiBusinessSelect = document.querySelector("[data-ai-business-select]");
  const aiUsageBody = document.querySelector("[data-ai-usage-body]");
  const aiResetButton = document.querySelector("[data-ai-reset-button]");
  let latestAiUsage = null;

  function sessionStorageSource() {
    return window.localStorage.getItem(tokenKey) ? window.localStorage : window.sessionStorage;
  }

  function syncNavForSession() {
    const hasToken = Boolean(sessionStorageSource().getItem(tokenKey));
    if (loginLink) loginLink.hidden = hasToken;
    if (signOutButton) signOutButton.hidden = !hasToken;
  }

  function configIsMissing() {
    return !authEndpoint;
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
    if (!refreshToken || configIsMissing()) return token;
    if (expiresAt && expiresAt - Date.now() > 60000) return token;
    return refreshSession(refreshToken, storage);
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function setAiStatus(message, tone = "info") {
    if (!aiQuotaStatus) return;
    aiQuotaStatus.textContent = message;
    aiQuotaStatus.className = `status${tone === "danger" ? " error" : ""}`;
  }

  function selectedAiBusinessId() {
    return String(aiBusinessSelect?.value || "").trim();
  }

  function syncAiResetState() {
    if (!aiResetButton) return;
    aiResetButton.disabled = !selectedAiBusinessId();
  }

  function setMetric(key, value) {
    const node = document.querySelector(`[data-metric="${key}"]`);
    if (node) node.textContent = String(value);
  }

  function formatUsd(value) {
    return Number(value || 0).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function quotaLabel(scope) {
    return {
      ad_generation: "AI ad generation",
      compose_offer: "AI compose offer",
      deal_copy: "Quick deal copy",
      deal_suggestions: "Deal suggestions",
      deal_translate: "Translations",
    }[scope] || scope;
  }

  function fillRows(selector, rows, emptyText) {
    const tbody = document.querySelector(selector);
    if (!tbody) return;
    tbody.innerHTML = "";
    const labels = selector.includes("applications")
      ? ["Business", "Email", "Status", "Access", "Created"]
      : ["Action", "Target", "Reason", "Type", "Created"];
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "admin-row-detail";
      td.textContent = emptyText;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement("tr");
      const cells = [
        row.business_name || row.action || "Unknown",
        row.email || row.target_type || "",
        row.status || row.reason || "",
        row.access_tier || row.action || "",
        row.created_at ? new Date(row.created_at).toLocaleString() : "",
      ];
      for (const [index, value] of cells.entries()) {
        const td = document.createElement("td");
        td.dataset.label = labels[index] || "";
        td.textContent = String(value ?? "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function fillAiBusinessSelect(businesses) {
    if (!aiBusinessSelect) return;
    aiBusinessSelect.innerHTML = "";
    if (!businesses.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No businesses found";
      aiBusinessSelect.appendChild(option);
      syncAiResetState();
      return;
    }
    for (const business of businesses) {
      const option = document.createElement("option");
      option.value = business.id;
      option.textContent = business.name ? `${business.name} (${business.status || "unknown"})` : business.id;
      aiBusinessSelect.appendChild(option);
    }
    syncAiResetState();
  }

  function fillAiUsageRows(businesses) {
    if (!aiUsageBody) return;
    aiUsageBody.innerHTML = "";
    if (!businesses.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "admin-row-detail";
      td.textContent = "No businesses found for that owner.";
      tr.appendChild(td);
      aiUsageBody.appendChild(tr);
      return;
    }
    for (const business of businesses) {
      for (const usage of business.usage || []) {
        const tr = document.createElement("tr");
        const labels = ["Business", "Quota", "Used", "Limit", "Remaining", "Counting since", "Last reset"];
        const cells = [
          business.name || business.id,
          quotaLabel(usage.scope),
          usage.used ?? 0,
          usage.limit ?? 0,
          usage.remaining ?? 0,
          formatDateTime(usage.countSince),
          formatDateTime(usage.resetAt) || "None this month",
        ];
        for (const [index, value] of cells.entries()) {
          const td = document.createElement("td");
          td.dataset.label = labels[index] || "";
          td.textContent = String(value ?? "");
          tr.appendChild(td);
        }
        aiUsageBody.appendChild(tr);
      }
    }
  }

  function networkFailureMessage(error) {
    if (error?.name === "AbortError") {
      return "The admin AI usage request timed out. Refresh the page and try again.";
    }
    return "Could not reach the admin AI usage service. Refresh this page and confirm the admin-ai-usage Edge Function is deployed.";
  }

  async function adminPost(url, body) {
    const token = await getAccessToken();
    if (!token) throw new Error("Admin session not connected.");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(networkFailureMessage(error));
    } finally {
      window.clearTimeout(timeout);
    }
    const payload = await readJson(response);
    if (response.status === 401) {
      clearSession();
      throw new Error("Admin session expired. Sign in again.");
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  function replaceBusinessUsage(updatedBusiness) {
    if (!latestAiUsage?.businesses || !updatedBusiness?.id) return;
    latestAiUsage.businesses = latestAiUsage.businesses.map((business) =>
      business.id === updatedBusiness.id ? updatedBusiness : business
    );
    fillAiUsageRows(latestAiUsage.businesses);
  }

  async function loadAiUsage() {
    if (!aiUsageEndpoint || !aiQuotaForm) return;
    latestAiUsage = null;
    fillAiBusinessSelect([]);
    syncAiResetState();
    const data = new FormData(aiQuotaForm);
    const query = String(data.get("query") || "").trim();
    if (!query) {
      setAiStatus("Enter an owner email or user ID.", "danger");
      return;
    }

    setAiStatus("Loading AI usage...");
    const payload = await adminPost(aiUsageEndpoint, { action: "lookup", query });
    latestAiUsage = payload;
    fillAiBusinessSelect(payload.businesses || []);
    fillAiUsageRows(payload.businesses || []);
    setAiStatus(
      payload.user
        ? `Loaded ${payload.user.email || payload.user.id}.`
        : "No matching Supabase Auth user was found.",
    );
  }

  async function resetSelectedQuota() {
    if (!aiUsageEndpoint || !aiQuotaForm) return;
    const data = new FormData(aiQuotaForm);
    const businessId = selectedAiBusinessId();
    const quotaScope = String(data.get("quota_scope") || "").trim();
    const reason = String(data.get("reason") || "").trim();
    if (!businessId || !quotaScope) {
      setAiStatus("Load an owner and choose a business/quota first.", "danger");
      return;
    }

    setAiStatus("Resetting selected quota...");
    const payload = await adminPost(aiUsageEndpoint, {
      action: "reset_quota",
      business_id: businessId,
      quota_scope: quotaScope,
      reason,
    });
    replaceBusinessUsage(payload.business);
    setAiStatus(`Reset ${quotaLabel(quotaScope)} for the selected business.`);
  }

  async function loadSummary() {
    if (!endpoint) return;
    const token = await getAccessToken();
    if (!token) {
      setStatus("Admin session not connected", "warning");
      return;
    }

    setStatus("Loading admin summary");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        clearSession();
        setStatus("Admin session expired. Sign in again.", "warning");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed");

      setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
      const s = payload.summary || {};
      setMetric("businesses.active", s.businesses?.active ?? 0);
      setMetric("businesses.pending", s.businesses?.pendingVerification ?? 0);
      setMetric("businesses.trialing", s.businesses?.trialingLocations ?? 0);
      setMetric("businesses.trialsEndingSoon", s.businesses?.trialsEndingSoon ?? 0);
      setMetric("trialRequests.open", s.trialRequests?.open ?? 0);
      setMetric("trialRequests.highRisk", s.trialRequests?.highRisk ?? 0);
      setMetric("offers.live", s.offers?.live ?? 0);
      setMetric("offers.needsReview", s.offers?.needsReview ?? 0);
      setMetric("apiSpend.currentMonthUsd", formatUsd(s.apiSpend?.currentMonthUsd ?? 0));
      setMetric("apiSpend.priorMonthUsd", formatUsd(s.apiSpend?.priorMonthUsd ?? 0));
      setMetric("apiSpend.updatedAt", s.apiSpend?.updatedAt ? `Updated ${formatDateTime(s.apiSpend.updatedAt)}` : "Not loaded");
      setMetric("activity.claimsToday", s.activity?.claimsToday ?? 0);
      setMetric("activity.redemptionsToday", s.activity?.redemptionsToday ?? 0);
      setMetric("billing.pastDue", s.billing?.pastDueLocations ?? 0);
      setMetric("billing.pastDueBusinesses", s.billing?.pastDueBusinesses ?? 0);
      setMetric("billing.missingCustomers", s.billing?.missingStripeCustomers ?? 0);
      setMetric("security.failedActions", s.security?.failedAdminActions ?? 0);
      setMetric("prospects.open", s.prospects?.open ?? 0);
      setMetric("prospects.readyToContact", s.prospects?.readyToContact ?? 0);
      setMetric("prospects.acceptedClaimLinks", s.prospects?.acceptedClaimLinksThisMonth ?? 0);

      fillRows("[data-applications-body]", payload.recentApplications || [], "No recent trial requests.");
      fillRows("[data-audit-body]", payload.recentAudit || [], "No recent audit events.");
    } catch {
      setStatus("Could not load admin summary", "danger");
    }
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  if (aiQuotaForm) {
    aiQuotaForm.addEventListener("submit", (event) => {
      event.preventDefault();
      loadAiUsage().catch((error) => {
        setAiStatus(error instanceof Error ? error.message : "Could not load AI usage.", "danger");
      });
    });
  }

  if (aiResetButton) {
    aiResetButton.addEventListener("click", () => {
      aiResetButton.disabled = true;
      resetSelectedQuota()
        .catch((error) => {
          setAiStatus(error instanceof Error ? error.message : "Could not reset quota.", "danger");
        })
        .finally(() => {
          syncAiResetState();
        });
    });
  }

  if (aiBusinessSelect) {
    aiBusinessSelect.addEventListener("change", syncAiResetState);
  }

  syncNavForSession();
  syncAiResetState();
  loadSummary();
})();
