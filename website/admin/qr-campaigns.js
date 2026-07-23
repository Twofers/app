(() => {
  const body = document.body;
  const authEndpoint = body.dataset.adminAuthEndpoint;
  const qrEndpoint = body.dataset.adminQrCampaignsEndpoint;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  const createForm = document.querySelector("[data-qr-create-form]");
  const rangeForm = document.querySelector("[data-qr-range-form]");
  const dialog = document.querySelector("[data-qr-dialog]");

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
    try { return await response.json(); } catch { return {}; }
  }

  async function getToken() {
    const storage = storageSource();
    const token = storage.getItem(tokenKey);
    const refreshToken = storage.getItem(refreshTokenKey);
    const expiresAt = Number(storage.getItem(expiresAtKey) || "0");
    if (!token) return null;
    if (!refreshToken || !authEndpoint || (expiresAt && expiresAt - Date.now() > 60000)) return token;
    const response = await fetch(authEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const payload = await readJson(response);
    if (!response.ok || !payload.ok || !payload.session?.access_token) throw new Error("Admin session expired. Sign in again.");
    storeSession(payload.session, storage);
    return payload.session.access_token;
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function setOutput(selector, message, tone = "info") {
    const node = document.querySelector(selector);
    if (!node) return;
    node.textContent = message || "";
    node.className = `status${tone === "danger" ? " error" : ""}`;
  }

  async function post(payload) {
    const token = await getToken();
    if (!token) throw new Error("Admin session not connected.");
    const response = await fetch(qrEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error(result.error || "Admin session expired. Sign in again.");
    }
    if (!response.ok || !result.ok) throw new Error(result.error || "Request failed.");
    return result;
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function label(value) {
    return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function renderRows(selector, rows, columns, emptyText) {
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
        if (value instanceof Node) td.appendChild(value);
        else td.textContent = value == null ? "" : String(value);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function campaignActions(campaign) {
    const wrap = document.createElement("div");
    wrap.className = "admin-qr-table-actions";
    const qrButton = document.createElement("button");
    qrButton.type = "button";
    qrButton.className = "button button-small button-secondary";
    qrButton.textContent = "Show QR";
    qrButton.addEventListener("click", () => showQr(campaign.campaign_id).catch((error) => setOutput("[data-qr-analytics-status]", error.message, "danger")));
    wrap.appendChild(qrButton);
    if (campaign.is_active) {
      const disableButton = document.createElement("button");
      disableButton.type = "button";
      disableButton.className = "button button-small button-secondary";
      disableButton.textContent = "Disable";
      disableButton.addEventListener("click", () => disableCampaign(campaign));
      wrap.appendChild(disableButton);
    }
    return wrap;
  }

  function renderAnalytics(analytics) {
    const campaigns = analytics.campaigns || [];
    const businesses = analytics.businesses || [];
    const sources = analytics.sources || [];
    const daily = analytics.daily || [];
    const totals = campaigns.reduce((out, row) => ({
      total: out.total + Number(row.scan_count || 0),
      human: out.human + Number(row.likely_human_scan_count || 0),
      bot: out.bot + Number(row.likely_bot_scan_count || 0),
    }), { total: 0, human: 0, bot: 0 });
    document.querySelector("[data-qr-total-scans]").textContent = String(totals.total);
    document.querySelector("[data-qr-human-scans]").textContent = String(totals.human);
    document.querySelector("[data-qr-bot-scans]").textContent = String(totals.bot);

    renderRows("[data-qr-campaigns-body]", campaigns, [
      { label: "Business", value: (r) => r.business_name || "" },
      { label: "Campaign", value: (r) => r.display_name || "" },
      { label: "Material", value: (r) => label(r.source_type) },
      { label: "Status", value: (r) => r.is_active ? "Active" : "Disabled" },
      { label: "Scans", value: (r) => r.scan_count || 0 },
      { label: "Likely physical", value: (r) => r.likely_human_scan_count || 0 },
      { label: "Created", value: (r) => formatDate(r.created_at) },
      { label: "Actions", value: (r) => campaignActions(r) },
    ], "No QR campaigns in this period.");
    renderRows("[data-qr-businesses-body]", businesses, [
      { label: "Business", value: (r) => r.business_name || "" },
      { label: "Scans", value: (r) => r.scan_count || 0 },
      { label: "Likely physical", value: (r) => r.likely_human_scan_count || 0 },
      { label: "Automated", value: (r) => r.likely_bot_scan_count || 0 },
    ], "No QR scans in this period.");
    renderRows("[data-qr-sources-body]", sources, [
      { label: "Material", value: (r) => label(r.source_type) },
      { label: "Scans", value: (r) => r.scan_count || 0 },
      { label: "Likely physical", value: (r) => r.likely_human_scan_count || 0 },
      { label: "Automated", value: (r) => r.likely_bot_scan_count || 0 },
    ], "No QR scans in this period.");
    renderRows("[data-qr-daily-body]", daily, [
      { label: "Date", value: (r) => r.scan_date || "" },
      { label: "Total requests", value: (r) => r.scan_count || 0 },
      { label: "Likely physical", value: (r) => r.likely_human_scan_count || 0 },
      { label: "Automated", value: (r) => r.likely_bot_scan_count || 0 },
    ], "No QR scans in this period.");
  }

  function renderBusinessOptions(businesses) {
    const select = document.querySelector("[data-qr-business-select]");
    if (!select) return;
    select.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Select a business";
    select.appendChild(blank);
    for (const business of businesses) {
      const option = document.createElement("option");
      option.value = business.id;
      option.textContent = `${business.name || business.id}${business.status ? ` (${label(business.status)})` : ""}`;
      select.appendChild(option);
    }
  }

  async function load() {
    const days = Number(new FormData(rangeForm).get("days") || 30);
    setStatus("Loading QR campaigns");
    setOutput("[data-qr-analytics-status]", "");
    const payload = await post({ action: "overview", days });
    setStatus("QR campaigns ready");
    renderBusinessOptions(payload.businesses || []);
    renderAnalytics(payload.analytics || {});
  }

  async function showQr(campaignId) {
    const payload = await post({ action: "qr", campaign_id: campaignId });
    document.querySelector("[data-qr-dialog-title]").textContent = payload.campaign?.display_name || "Campaign QR code";
    document.querySelector("[data-qr-image]").src = payload.qr_svg_data_url;
    document.querySelector("[data-qr-url]").textContent = payload.campaign?.tracking_url || "";
    const download = document.querySelector("[data-qr-download]");
    download.href = payload.qr_svg_data_url;
    download.download = `${payload.campaign?.slug || "twofer-qr-campaign"}.svg`;
    setOutput("[data-qr-dialog-status]", "");
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  async function disableCampaign(campaign) {
    if (!window.confirm(`Disable “${campaign.display_name}”? Existing printed codes will go to the Twofer website and stop recording scans.`)) return;
    try {
      setOutput("[data-qr-analytics-status]", "Disabling campaign…");
      await post({ action: "disable", campaign_id: campaign.campaign_id });
      setOutput("[data-qr-analytics-status]", "Campaign disabled.");
      await load();
    } catch (error) {
      setOutput("[data-qr-analytics-status]", error instanceof Error ? error.message : "Could not disable campaign.", "danger");
    }
  }

  if (signOutButton) signOutButton.addEventListener("click", () => {
    clearSession();
    window.location.assign("/admin/login");
  });
  if (rangeForm) rangeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    load().catch((error) => setOutput("[data-qr-analytics-status]", error instanceof Error ? error.message : "Could not load campaigns.", "danger"));
  });
  if (createForm) createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const data = new FormData(createForm);
      setOutput("[data-qr-create-status]", "Creating campaign…");
      const payload = await post({
        action: "create",
        business_id: data.get("business_id"),
        source_type: data.get("source_type"),
        display_name: data.get("display_name"),
        destination_type: data.get("destination_type"),
      });
      createForm.reset();
      setOutput("[data-qr-create-status]", "Campaign created. QR code is ready.");
      await load();
      await showQr(payload.campaign.id);
    } catch (error) {
      setOutput("[data-qr-create-status]", error instanceof Error ? error.message : "Could not create campaign.", "danger");
    }
  });
  document.querySelector("[data-qr-dialog-close]")?.addEventListener("click", () => dialog.close());
  document.querySelector("[data-qr-copy-url]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.querySelector("[data-qr-url]").textContent || "");
      setOutput("[data-qr-dialog-status]", "Tracking URL copied.");
    } catch {
      setOutput("[data-qr-dialog-status]", "Could not copy the tracking URL.", "danger");
    }
  });

  syncNav();
  load().catch((error) => {
    setStatus("Could not load QR campaigns", "danger");
    setOutput("[data-qr-analytics-status]", error instanceof Error ? error.message : "Could not load campaigns.", "danger");
  });
})();
