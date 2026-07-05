(() => {
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const reportEndpoint = document.body.dataset.adminAiOperatingReportEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  let latestReport = null;

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

  function fillMetric(key, value) {
    const node = document.querySelector(`[data-report-metric="${key}"]`);
    if (node) node.textContent = String(value ?? 0);
  }

  function renderRows(selector, rows, columns, empty) {
    const tbody = document.querySelector(selector);
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length;
      td.className = "admin-row-detail";
      td.textContent = empty;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const column of columns) {
        const td = document.createElement("td");
        td.dataset.label = column.label;
        td.textContent = String(column.value(row) ?? "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function reportFilters() {
    const form = document.querySelector("[data-report-filter-form]");
    if (!form) return {};
    const data = new FormData(form);
    return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value || "").trim()]).filter(([, value]) => value));
  }

  function setFounderSummary(report) {
    const node = document.querySelector("[data-founder-summary]");
    if (!node) return;
    node.textContent = [
      report.founder_summary || "",
      "",
      "Recommended next actions:",
      ...(report.recommended_next_actions || []),
      "",
      "Risks to watch:",
      ...(report.risks_to_watch || []),
    ].filter((line) => line !== undefined).join("\n");
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reportFilename(suffix) {
    const stamp = new Date().toISOString().slice(0, 10);
    return `twofer-admin-ai-${suffix}-${stamp}.csv`;
  }

  function summaryRows(report) {
    const rows = [
      ["section", "name", "value", "detail_1", "detail_2", "detail_3"],
      ["meta", "generated_at", report.generated_at || "", "", "", ""],
      ["meta", "month_start", report.month_start || "", "", "", ""],
      ["meta", "date_end", report.date_end || "", "", "", ""],
      ...Object.entries(report.filters || {}).map(([key, value]) => ["filter", key, value || "", "", "", ""]),
      ["ai", "enrichments", report.ai?.enrichment_volume ?? 0],
      ["prospects", "needing_review", report.prospects?.needing_review ?? 0],
      ["prospects", "stale_sources", report.prospects?.stale_source_count ?? 0],
      ["prospects", "tier_a", report.prospects?.score_distribution?.A ?? 0],
      ["prospects", "tier_b", report.prospects?.score_distribution?.B ?? 0],
      ["prospects", "tier_c", report.prospects?.score_distribution?.C ?? 0],
      ["prospects", "do_not_contact", report.prospects?.score_distribution?.["Do Not Contact"] ?? 0],
      ["claim_links", "sent", report.claim_links?.sent ?? 0],
      ["claim_links", "accepted", report.claim_links?.accepted ?? 0],
      ["claim_links", "expired", report.claim_links?.expired ?? 0],
      ["conversions", "prospect_to_trial", report.conversions?.prospect_to_trial ?? 0],
      ["conversions", "trial_to_active", report.conversions?.trial_to_active ?? 0],
      ["summary", "founder_summary", report.founder_summary || "", "", "", ""],
      ...(report.recommended_next_actions || []).map((value, index) => ["summary", `recommended_action_${index + 1}`, value, "", "", ""]),
      ...(report.risks_to_watch || []).map((value, index) => ["summary", `risk_${index + 1}`, value, "", "", ""]),
    ];
    return rows.map((row) => [...row, "", "", ""].slice(0, 6));
  }

  function costRows(report) {
    return [
      ["section", "feature", "model", "endpoint", "cost_usd", "calls", "failures"],
      ...(report.ai?.cost_by_feature_model || []).map((row) => [
        "cost",
        row.feature || "",
        row.model || "",
        row.endpoint || "",
        Number(row.total_ai_cost_usd || 0).toFixed(6),
        row.call_count ?? 0,
        row.failed_or_retried_calls ?? 0,
      ]),
    ];
  }

  function failureRows(report) {
    return [
      ["section", "feature", "provider", "model", "error_code", "created_at"],
      ...(report.ai?.provider_failures || []).map((row) => [
        "failed_ai_call",
        row.feature || "",
        row.provider || "",
        row.model || "",
        row.error_code || "",
        row.created_at || "",
      ]),
    ];
  }

  function providerRows(report) {
    return [
      ["section", "provider", "capability", "state", "failure_count", "disabled_until", "updated_at"],
      ...(report.ai?.circuit_breakers || []).map((row) => [
        "provider_health",
        row.provider || "",
        row.capability || "",
        row.state || "",
        row.failure_count ?? 0,
        row.disabled_until || "",
        row.updated_at || "",
      ]),
    ];
  }

  function opsRows(report) {
    return [
      ["section", "action", "target_type", "reason", "created_at"],
      ...(report.recent_admin_activity || []).map((row) => [
        "recent_admin_activity",
        row.action || "",
        row.target_type || "",
        row.reason || "",
        row.created_at || "",
      ]),
    ];
  }

  function exportCsv() {
    if (!latestReport) return;
    const rows = [
      ...summaryRows(latestReport),
      [],
      ...costRows(latestReport),
      [],
      ...failureRows(latestReport),
      [],
      ...providerRows(latestReport),
      [],
      ...opsRows(latestReport),
    ];
    downloadCsv(reportFilename("operating-report"), rows);
  }

  function exportFailedAiCsv() {
    if (!latestReport) return;
    downloadCsv(reportFilename("failed-ai-calls"), failureRows(latestReport));
  }

  function exportProspectOpsCsv() {
    if (!latestReport) return;
    downloadCsv(reportFilename("prospect-ops"), opsRows(latestReport));
  }

  async function loadReport() {
    const token = await getToken();
    if (!token) {
      setStatus("Admin session not connected", "warning");
      return;
    }
    setStatus("Loading report");
    const response = await fetch(reportEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(reportFilters()),
    });
    const payload = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      setStatus(payload.error || "Admin session expired", "warning");
      return;
    }
    if (!response.ok || !payload.ok) throw new Error(payload.error || "Could not load report.");
    setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
    const report = payload.report || {};
    latestReport = report;
    fillMetric("ai.enrichment", report.ai?.enrichment_volume);
    fillMetric("prospects.review", report.prospects?.needing_review);
    fillMetric("prospects.stale", report.prospects?.stale_source_count);
    fillMetric("score.a", report.prospects?.score_distribution?.A);
    fillMetric("score.b", report.prospects?.score_distribution?.B);
    fillMetric("score.c", report.prospects?.score_distribution?.C);
    fillMetric("score.doNotContact", report.prospects?.score_distribution?.["Do Not Contact"]);
    fillMetric("demand.proof", report.demand_and_sales?.demand_proof_generated);
    fillMetric("sales.activity", report.demand_and_sales?.sales_activity_count);
    fillMetric("claim.sent", report.claim_links?.sent);
    fillMetric("claim.accepted", report.claim_links?.accepted);
    fillMetric("claim.expired", report.claim_links?.expired);
    fillMetric("conversion.trial", report.conversions?.prospect_to_trial);
    fillMetric("conversion.active", report.conversions?.trial_to_active);
    setFounderSummary(report);

    renderRows("[data-cost-body]", report.ai?.cost_by_feature_model || [], [
      { label: "Feature", value: (r) => r.feature },
      { label: "Model", value: (r) => r.model },
      { label: "Endpoint", value: (r) => r.endpoint },
      { label: "Cost", value: (r) => `$${Number(r.total_ai_cost_usd || 0).toFixed(4)}` },
      { label: "Calls", value: (r) => r.call_count },
      { label: "Failures", value: (r) => r.failed_or_retried_calls },
    ], "No AI cost rows yet.");
    renderRows("[data-provider-body]", report.ai?.circuit_breakers || [], [
      { label: "Provider", value: (r) => r.provider },
      { label: "Capability", value: (r) => r.capability },
      { label: "State", value: (r) => r.state },
      { label: "Failures", value: (r) => r.failure_count },
      { label: "Disabled until", value: (r) => r.disabled_until || "" },
    ], "No circuit breaker rows.");
    renderRows("[data-failed-ai-body]", report.ai?.provider_failures || [], [
      { label: "Feature", value: (r) => r.feature },
      { label: "Provider", value: (r) => r.provider },
      { label: "Model", value: (r) => r.model },
      { label: "Error", value: (r) => r.error_code || "" },
      { label: "Created", value: (r) => r.created_at ? new Date(r.created_at).toLocaleString() : "" },
    ], "No failed AI calls in this period.");
    renderRows("[data-audit-body]", report.recent_admin_activity || [], [
      { label: "Action", value: (r) => r.action },
      { label: "Target", value: (r) => r.target_type },
      { label: "Reason", value: (r) => r.reason || "" },
      { label: "Created", value: (r) => r.created_at ? new Date(r.created_at).toLocaleString() : "" },
    ], "No recent prospect activity.");
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  document.querySelector("[data-refresh-report]")?.addEventListener("click", () => {
    loadReport().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load report.", "danger"));
  });

  document.querySelector("[data-export-report]")?.addEventListener("click", exportCsv);
  document.querySelector("[data-export-failed-ai]")?.addEventListener("click", exportFailedAiCsv);
  document.querySelector("[data-export-prospect-ops]")?.addEventListener("click", exportProspectOpsCsv);

  document.querySelector("[data-copy-founder-summary]")?.addEventListener("click", () => {
    const text = document.querySelector("[data-founder-summary]")?.textContent || "";
    navigator.clipboard.writeText(text).catch(() => {});
  });

  syncNav();
  loadReport().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load report.", "danger"));
})();
