(() => {
  const body = document.body;
  const authEndpoint = body.dataset.adminAuthEndpoint;
  const summaryEndpoint = body.dataset.adminSummaryEndpoint;
  const demandEndpoint = body.dataset.adminDemandProofEndpoint;
  const scriptEndpoint = body.dataset.adminSalesScriptEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const queueStatus = document.querySelector("[data-queue-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const tbody = document.querySelector("[data-sales-ai-body]");
  const output = document.querySelector("[data-sales-ai-output]");

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

  function setQueueStatus(message, tone = "info") {
    if (!queueStatus) return;
    queueStatus.textContent = message;
    queueStatus.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  async function post(url, payload) {
    const token = await getToken();
    if (!token) throw new Error("Admin session not connected.");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error(json.error || "Admin session expired. Sign in again.");
    }
    if (!response.ok || !json.ok) throw new Error(json.error || "Request failed.");
    return json;
  }

  function scoreValue(row) {
    return Number(row.score?.total_score || 0);
  }

  function bucket(row) {
    const stage = String(row.sales_account?.stage || row.status || "");
    if (stage === "claim_link_sent") return "Send follow-up";
    if (stage === "claimed") return "Ready for trial";
    if (stage === "trial_created") return "Needs first offer";
    if (scoreValue(row) >= 80) return "Visit today";
    if (scoreValue(row) >= 60) return "Call today";
    if (row.demand_count > 0) return "Needs claim link";
    return "Send follow-up";
  }

  function setCount(key, value) {
    const node = document.querySelector(`[data-queue-count="${key}"]`);
    if (node) node.textContent = String(value);
  }

  function renderQueue(rows) {
    if (!tbody) return;
    tbody.innerHTML = "";
    const counts = { visit: 0, call: 0, follow: 0, claim: 0, trial: 0, offer: 0, ending: 0, billing: 0 };
    const sorted = [...rows].sort((left, right) => scoreValue(right) - scoreValue(left)).slice(0, 80);
    for (const row of sorted) {
      const itemBucket = bucket(row);
      if (itemBucket === "Visit today") counts.visit += 1;
      if (itemBucket === "Call today") counts.call += 1;
      if (itemBucket === "Send follow-up") counts.follow += 1;
      if (itemBucket === "Needs claim link") counts.claim += 1;
      if (itemBucket === "Ready for trial") counts.trial += 1;
      if (itemBucket === "Needs first offer") counts.offer += 1;

      const tr = document.createElement("tr");
      const cells = [
        ["Priority", itemBucket],
        ["Business", row.display_name || row.id],
        ["City", [row.city, row.state].filter(Boolean).join(", ")],
        ["Score", row.score ? `${row.score.total_score} / ${row.score.tier}` : ""],
        ["Stage", row.sales_account?.stage || row.status || ""],
        ["Suggested next action", row.sales_account?.next_action || row.score?.recommended_next_action || ""],
      ];
      for (const [label, value] of cells) {
        const td = document.createElement("td");
        td.dataset.label = label;
        if (label === "Business") {
          const link = document.createElement("a");
          link.href = `/admin/prospects/${row.id}`;
          link.textContent = String(value);
          td.appendChild(link);
        } else {
          td.textContent = String(value || "");
        }
        tr.appendChild(td);
      }
      const tools = document.createElement("td");
      tools.dataset.label = "Tools";
      tools.className = "admin-inline-actions";
      for (const [action, label] of [["demand", "Demand"], ["script", "Script"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-small button-secondary";
        button.dataset.action = action;
        button.dataset.prospectId = row.id;
        button.textContent = label;
        tools.appendChild(button);
      }
      tr.appendChild(tools);
      tbody.appendChild(tr);
    }
    for (const [key, value] of Object.entries(counts)) setCount(key, value);
    if (!sorted.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 7;
      td.className = "admin-row-detail";
      td.textContent = "No prospects are ready for the queue.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  async function loadQueue() {
    setQueueStatus("Loading");
    const payload = await post(summaryEndpoint, { section: "prospects" });
    setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
    renderQueue(payload.prospects || []);
    setQueueStatus(`Loaded ${(payload.prospects || []).length} prospects`);
  }

  async function runTool(action, prospectId) {
    if (!output) return;
    output.textContent = "Working...";
    const endpoint = action === "demand" ? demandEndpoint : scriptEndpoint;
    const payload = action === "demand"
      ? await post(endpoint, { prospect_id: prospectId })
      : await post(endpoint, { prospect_id: prospectId, script_type: "call", tone: "founder-led" });
    output.textContent = action === "demand"
      ? [
          ...(payload.report?.merchant_safe_lines || []),
          payload.report?.exports?.in_person_pitch || "",
          payload.report?.exports?.email_pitch || "",
        ].filter(Boolean).join("\n\n")
      : (payload.script_bundle ? JSON.stringify(payload.script_bundle, null, 2) : payload.script || "");
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  document.querySelector("[data-refresh-queue]")?.addEventListener("click", () => {
    loadQueue().catch((error) => setQueueStatus(error instanceof Error ? error.message : "Could not load queue.", "danger"));
  });

  tbody?.addEventListener("click", (event) => {
    const button = event.target instanceof HTMLElement ? event.target.closest("button[data-action]") : null;
    if (!button) return;
    runTool(button.dataset.action || "", button.dataset.prospectId || "")
      .catch((error) => {
        if (output) output.textContent = error instanceof Error ? error.message : "Request failed.";
      });
  });

  syncNav();
  loadQueue().catch((error) => {
    setStatus("Admin session not connected", "warning");
    setQueueStatus(error instanceof Error ? error.message : "Could not load queue.", "danger");
  });
})();
