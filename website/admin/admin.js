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
  const businessHealthBody = document.querySelector("[data-business-health-body]");
  const businessHealthWarning = document.querySelector("[data-business-health-warning]");
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
    const toneClass =
      tone === "danger" ? " danger" : tone === "warning" ? " warning" : tone === "success" ? " success" : "";
    statusEl.className = `admin-badge${toneClass}`;
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

  function numericMetricValue(value) {
    if (typeof value === "number") return value;
    const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function syncMetricTone(key, value) {
    const count = numericMetricValue(value);
    for (const node of document.querySelectorAll(`[data-metric="${key}"]`)) {
      const container = node.closest(".admin-card, .admin-next-action");
      if (!container) continue;
      container.classList.toggle("is-zero", count !== null && count === 0);
      container.classList.toggle("has-attention", count !== null && count > 0 && container.hasAttribute("data-action-count"));
    }
  }

  function setMetric(key, value) {
    const nodes = document.querySelectorAll(`[data-metric="${key}"]`);
    for (const node of nodes) node.textContent = String(value);
    syncMetricTone(key, value);
  }

  function initializeMetricTones() {
    const keys = new Set(
      [...document.querySelectorAll("[data-metric]")]
        .map((node) => node.getAttribute("data-metric"))
        .filter(Boolean),
    );
    for (const key of keys) {
      const node = document.querySelector(`[data-metric="${key}"]`);
      syncMetricTone(key, node?.textContent || "0");
    }
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

  function formatRate(numerator, denominator) {
    const top = Number(numerator || 0);
    const bottom = Number(denominator || 0);
    if (!bottom) return "0%";
    return `${Math.round((top / bottom) * 100)}%`;
  }

  function healthLabel(value) {
    return {
      needs_attention: "Needs attention",
      watch: "Watch",
      healthy: "Healthy",
      celebrate: "Celebrate",
    }[value] || "Watch";
  }

  function healthTone(value) {
    return {
      needs_attention: "danger",
      watch: "warning",
      healthy: "success",
      celebrate: "success",
    }[value] || "info";
  }

  function formatNullableNumber(value, fallback = "") {
    const number = Number(value);
    return Number.isFinite(number) ? String(number) : fallback;
  }

  function formatTrialDays(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number < 0) return "Expired";
    if (number === 0) return "Ends today";
    return `${number}d left`;
  }

  function formatAiRisk(value) {
    return value === "high" ? "High" : value === "watch" ? "Watch" : "";
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

  function fillBusinessHealthRows(rows, errorMessage) {
    if (businessHealthWarning) {
      businessHealthWarning.hidden = !errorMessage;
      businessHealthWarning.textContent = errorMessage || "";
    }
    if (!businessHealthBody) return;
    businessHealthBody.innerHTML = "";
    if (errorMessage) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.className = "admin-row-detail";
      td.textContent = "Business health is temporarily unavailable. The rest of the dashboard is still loaded.";
      tr.appendChild(td);
      businessHealthBody.appendChild(tr);
      return;
    }
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.className = "admin-row-detail";
      td.textContent = "No business health issues found from current data.";
      tr.appendChild(td);
      businessHealthBody.appendChild(tr);
      return;
    }
    const labels = ["Business", "Health", "Reason", "Live offers", "Claims 30d", "Redemptions 30d", "Trial", "AI", "Action"];
    for (const row of rows) {
      const tr = document.createElement("tr");
      const detailHref = row.business_id
        ? `/admin/businesses/${row.business_id}?return=${encodeURIComponent("/admin")}`
        : "";
      const cells = [
        detailHref
          ? { href: detailHref, text: row.business_name || row.business_id || "Unknown" }
          : row.business_name || row.business_id || "Unknown",
        { badge: healthLabel(row.health_label), tone: healthTone(row.health_label) },
        row.primary_reason || "",
        formatNullableNumber(row.live_offer_count, "0"),
        formatNullableNumber(row.claims_30d, "0"),
        formatNullableNumber(row.redemptions_30d, "0"),
        formatTrialDays(row.trial_days_remaining),
        formatAiRisk(row.ai_quota_risk),
        { href: detailHref || "/admin/businesses", text: row.suggested_read_only_action || "View business" },
      ];
      for (const [index, value] of cells.entries()) {
        const td = document.createElement("td");
        td.dataset.label = labels[index] || "";
        if (value && typeof value === "object" && "badge" in value) {
          const badge = document.createElement("span");
          badge.className = `admin-badge ${value.tone || "info"}`;
          badge.textContent = value.badge;
          td.appendChild(badge);
        } else if (value && typeof value === "object" && value.href) {
          const link = document.createElement("a");
          link.href = value.href;
          link.textContent = value.text;
          td.appendChild(link);
        } else {
          td.textContent = String(value ?? "");
        }
        tr.appendChild(td);
      }
      businessHealthBody.appendChild(tr);
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
    setStatus("Checking admin session");
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

      setStatus(`Signed in as ${payload.admin?.role || "admin"}`, "success");

      try {
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
        setMetric(
          "activity.claimRedemptionRate",
          formatRate(s.activity?.redemptionsToday ?? 0, s.activity?.claimsToday ?? 0),
        );
        setMetric("billing.pastDue", s.billing?.pastDueLocations ?? 0);
        setMetric("billing.pastDueBusinesses", s.billing?.pastDueBusinesses ?? 0);
        setMetric("billing.missingCustomers", s.billing?.missingStripeCustomers ?? 0);
        setMetric("billing.failedEvents", s.billing?.stripeWebhookErrors ?? 0);
        setMetric("security.failedActions", s.security?.failedAdminActions ?? 0);
        setMetric("prospects.open", s.prospects?.open ?? 0);
        setMetric("prospects.readyToContact", s.prospects?.readyToContact ?? 0);
        setMetric("prospects.acceptedClaimLinks", s.prospects?.acceptedClaimLinksThisMonth ?? 0);
        const businessHealthRows = payload.businessHealth || [];
        const businessHealthLoaded = !payload.businessHealthError && Array.isArray(payload.businessHealth);
        const businessHealthAttention = businessHealthLoaded
          ? businessHealthRows.filter((row) => Number(row.attention_score || 0) > 0).length
          : 0;
        setMetric(
          "businesses.needingAttention",
          businessHealthLoaded ? businessHealthAttention : "N/A",
        );

        fillRows("[data-applications-body]", payload.recentApplications || [], "No recent trial requests.");
        fillRows("[data-audit-body]", payload.recentAudit || [], "No recent audit events.");
        fillBusinessHealthRows(businessHealthRows, payload.businessHealthError || "");
      } catch {
        setMetric("businesses.needingAttention", "N/A");
        fillBusinessHealthRows([], "Business health could not be loaded.");
      }
    } catch {
      setStatus("Could not load admin summary", "danger");
      fillBusinessHealthRows([], "Business health could not be loaded.");
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
  initializeMetricTones();
  loadSummary();
})();
