(() => {
  const endpoint = document.body.dataset.adminSummaryEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const statusEl = document.querySelector("[data-admin-status]");
  const token = window.sessionStorage.getItem(tokenKey) || window.localStorage.getItem(tokenKey);

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function setMetric(key, value) {
    const node = document.querySelector(`[data-metric="${key}"]`);
    if (node) node.textContent = String(value);
  }

  function fillRows(selector, rows, emptyText) {
    const tbody = document.querySelector(selector);
    if (!tbody) return;
    tbody.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
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
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = String(value ?? "");
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  async function loadSummary() {
    if (!endpoint) return;
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
      const payload = await response.json();
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
      setMetric("activity.claimsToday", s.activity?.claimsToday ?? 0);
      setMetric("activity.redemptionsToday", s.activity?.redemptionsToday ?? 0);
      setMetric("billing.pastDue", s.billing?.pastDueLocations ?? 0);
      setMetric("billing.pastDueBusinesses", s.billing?.pastDueBusinesses ?? 0);
      setMetric("billing.missingCustomers", s.billing?.missingStripeCustomers ?? 0);
      setMetric("security.failedActions", s.security?.failedAdminActions ?? 0);

      fillRows("[data-applications-body]", payload.recentApplications || [], "No recent trial requests.");
      fillRows("[data-audit-body]", payload.recentAudit || [], "No recent audit events.");
    } catch {
      setStatus("Could not load admin summary", "danger");
    }
  }

  loadSummary();
})();
