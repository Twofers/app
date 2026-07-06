(() => {
  const authEndpoint = document.body.dataset.adminAuthEndpoint;
  const summaryEndpoint = document.body.dataset.adminSummaryEndpoint;
  const section = document.body.dataset.adminSection;
  const tokenKey = "twofer_admin_access_token";
  const refreshTokenKey = "twofer_admin_refresh_token";
  const expiresAtKey = "twofer_admin_expires_at";
  const statusEl = document.querySelector("[data-admin-status]");
  const signOutButton = document.querySelector("[data-admin-sign-out]");
  const loginLink = document.querySelector("[data-admin-login-link]");
  let currentDirectoryRows = [];
  let directoryControlsState = { q: "", filters: {}, sortKey: "", dir: "asc" };

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
    if (!refreshToken || !authEndpoint) return token;
    if (expiresAt && expiresAt - Date.now() > 60000) return token;
    return refreshSession(refreshToken, storage);
  }

  function setStatus(message, tone = "info") {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : ""}`;
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
  }

  function formatUsd(value) {
    return Number(value || 0).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function healthLabel(value) {
    return {
      needs_attention: "Needs attention",
      watch: "Watch",
      healthy: "Healthy",
      celebrate: "Celebrate",
    }[value] || "Unknown";
  }

  function healthTone(value) {
    return {
      needs_attention: "danger",
      watch: "warning",
      healthy: "success",
      celebrate: "success",
    }[value] || "info";
  }

  function formatTrialDays(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number < 0) return "Expired";
    if (number === 0) return "Ends today";
    return `${number}d left`;
  }

  function formatAiRisk(value) {
    return { high: "High", watch: "Watch", normal: "Normal" }[value] || "";
  }

  function setText(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  }

  function toneForStatus(raw) {
    const value = String(raw ?? "").toLowerCase();
    if (!value) return "";
    if (/(past_due|delinquent|failed|error|suspend|reject|block|cancel|spam|fraud|deleted|high)/.test(value)) return "danger";
    if (/(pending|review|needs|unverified|queued|medium|hold|waitlist)/.test(value)) return "warning";
    if (/(active|verified|processed|live|approved|paid|complete|succeed|success|low)/.test(value)) return "success";
    return "info";
  }

  function statusCell(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return "";
    return { badge: text, tone: toneForStatus(text) };
  }

  const ERROR_MESSAGES = {
    error: "Could not load this data. Refresh the page to try again.",
    expired: "Your admin session expired. Sign in again to continue.",
  };

  function setTablesState(mode) {
    for (const table of document.querySelectorAll(".admin-table")) {
      const tbody = table.querySelector("tbody");
      if (!tbody) continue;
      const headers = table.querySelectorAll("thead th");
      const cols = headers.length || 1;
      tbody.innerHTML = "";
      if (mode === "loading") {
        for (let r = 0; r < 4; r += 1) {
          const tr = document.createElement("tr");
          tr.setAttribute("aria-hidden", "true");
          for (let c = 0; c < cols; c += 1) {
            const td = document.createElement("td");
            if (headers[c]) td.dataset.label = headers[c].textContent || "";
            const bar = document.createElement("span");
            bar.className = "admin-skeleton";
            td.appendChild(bar);
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
      } else {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = cols;
        td.className = "admin-row-detail";
        td.textContent = ERROR_MESSAGES[mode] || ERROR_MESSAGES.error;
        tr.appendChild(td);
        tbody.appendChild(tr);
      }
    }
  }

  function fillTable(selector, rows, columns, emptyText) {
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
        if (value && typeof value === "object" && value.href) {
          const link = document.createElement("a");
          link.href = value.href;
          link.textContent = value.text;
          td.appendChild(link);
        } else if (value && typeof value === "object" && "badge" in value) {
          const badge = document.createElement("span");
          badge.className = `admin-badge${value.tone ? ` ${value.tone}` : ""}`;
          badge.textContent = value.badge;
          td.appendChild(badge);
        } else {
          td.textContent = String(value ?? "");
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  function formatOptionLabel(value) {
    return String(value)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function buildFilterOptions(filterConfig, rows) {
    if (filterConfig.options) return filterConfig.options;
    const seen = new Set();
    for (const row of rows) {
      const value = filterConfig.getValue(row);
      if (value) seen.add(String(value));
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: formatOptionLabel(value) }));
  }

  function matchesSearch(row, config, query) {
    if (!query) return true;
    const haystack = config.searchFields
      .map((field) => String(row[field] ?? ""))
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function matchesFilters(row, config, filters) {
    return config.filters.every((filterConfig) => {
      const active = filters[filterConfig.key];
      if (!active) return true;
      return String(filterConfig.getValue(row) ?? "") === active;
    });
  }

  function compareRows(a, b, sortDef, dir) {
    const av = sortDef.getValue ? sortDef.getValue(a) : a[sortDef.key];
    const bv = sortDef.getValue ? sortDef.getValue(b) : b[sortDef.key];
    let result;
    if (sortDef.type === "date") {
      result = new Date(av).getTime() - new Date(bv).getTime();
    } else if (sortDef.type === "number") {
      result = Number(av) - Number(bv);
    } else {
      result = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
    }
    return dir === "desc" ? -result : result;
  }

  function isSortValueEmpty(row, sortDef) {
    const raw = sortDef.getValue ? sortDef.getValue(row) : row[sortDef.key];
    if (raw === null || raw === undefined || raw === "") return true;
    if (sortDef.type === "date") return Number.isNaN(new Date(raw).getTime());
    return false;
  }

  function applyDirectoryControls(config, rows, state) {
    const filtered = rows.filter((row) => matchesSearch(row, config, state.q) && matchesFilters(row, config, state.filters));
    if (!state.sortKey) return filtered;
    const sortDef = config.sortOptions.find((option) => option.key === state.sortKey);
    if (!sortDef) return filtered;
    const withValue = [];
    const withoutValue = [];
    for (const row of filtered) {
      (isSortValueEmpty(row, sortDef) ? withoutValue : withValue).push(row);
    }
    withValue.sort((a, b) => compareRows(a, b, sortDef, state.dir));
    return withValue.concat(withoutValue);
  }

  function isDirectoryStateActive(state) {
    if (state.q) return true;
    if (state.sortKey) return true;
    return Object.values(state.filters).some(Boolean);
  }

  function readDirectoryStateFromUrl(config) {
    const params = new URLSearchParams(window.location.search);
    const state = {
      q: params.get("q") || "",
      filters: {},
      sortKey: params.get("sort") || "",
      dir: params.get("dir") === "desc" ? "desc" : "asc",
    };
    for (const filterConfig of config.filters) {
      const value = params.get(filterConfig.key);
      if (value) state.filters[filterConfig.key] = value;
    }
    return state;
  }

  function writeDirectoryStateToUrl(config, state) {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    for (const filterConfig of config.filters) {
      const value = state.filters[filterConfig.key];
      if (value) params.set(filterConfig.key, value);
    }
    if (state.sortKey) {
      params.set("sort", state.sortKey);
      if (state.dir === "desc") params.set("dir", "desc");
    }
    const query = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
  }

  function updateDirectoryCount(total, shown) {
    const countEl = document.querySelector("[data-directory-count]");
    if (!countEl) return;
    countEl.textContent = total === 0 ? "" : shown === total ? `${total} total` : `Showing ${shown} of ${total}`;
  }

  function refreshDirectoryView(config) {
    const filtered = applyDirectoryControls(config, currentDirectoryRows, directoryControlsState);
    const emptyText = currentDirectoryRows.length === 0 ? config.emptyText : config.noMatchText;
    fillTable(config.selector, filtered, config.columns, emptyText);
    updateDirectoryCount(currentDirectoryRows.length, filtered.length);
    const clearButton = document.querySelector("[data-directory-clear]");
    if (clearButton) clearButton.hidden = !isDirectoryStateActive(directoryControlsState);
  }

  function buildToolbar(container, config, rows) {
    container.innerHTML = "";
    const controlsRow = document.createElement("div");
    controlsRow.className = "admin-toolbar-controls";

    const searchLabel = document.createElement("label");
    searchLabel.className = "admin-toolbar-field";
    const searchSpan = document.createElement("span");
    searchSpan.textContent = "Search";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.autocomplete = "off";
    searchInput.placeholder = "Search";
    searchInput.dataset.directorySearch = "";
    searchInput.value = directoryControlsState.q;
    searchInput.addEventListener("input", () => {
      directoryControlsState.q = searchInput.value.trim();
      refreshDirectoryView(config);
      writeDirectoryStateToUrl(config, directoryControlsState);
    });
    searchLabel.append(searchSpan, searchInput);
    controlsRow.appendChild(searchLabel);

    const filterSelects = [];
    for (const filterConfig of config.filters) {
      const label = document.createElement("label");
      label.className = "admin-toolbar-field";
      const span = document.createElement("span");
      span.textContent = filterConfig.label;
      const select = document.createElement("select");
      select.dataset.directoryFilter = filterConfig.key;
      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = `All ${filterConfig.label.toLowerCase()}`;
      select.appendChild(allOption);
      const derivedOptions = buildFilterOptions(filterConfig, rows);
      for (const option of derivedOptions) {
        const optionEl = document.createElement("option");
        optionEl.value = option.value;
        optionEl.textContent = option.label;
        select.appendChild(optionEl);
      }
      const activeFilterValue = directoryControlsState.filters[filterConfig.key] || "";
      if (activeFilterValue && !derivedOptions.some((option) => option.value === activeFilterValue)) {
        // Deep-linked value not present in the currently loaded rows -- keep it visible instead of
        // silently falling back to "All" while the table stays filtered to zero rows.
        const activeOptionEl = document.createElement("option");
        activeOptionEl.value = activeFilterValue;
        activeOptionEl.textContent = formatOptionLabel(activeFilterValue);
        select.appendChild(activeOptionEl);
      }
      select.value = activeFilterValue;
      select.addEventListener("change", () => {
        if (select.value) directoryControlsState.filters[filterConfig.key] = select.value;
        else delete directoryControlsState.filters[filterConfig.key];
        refreshDirectoryView(config);
        writeDirectoryStateToUrl(config, directoryControlsState);
      });
      label.append(span, select);
      controlsRow.appendChild(label);
      filterSelects.push(select);
    }

    const sortLabel = document.createElement("label");
    sortLabel.className = "admin-toolbar-field";
    const sortSpan = document.createElement("span");
    sortSpan.textContent = "Sort";
    const sortSelect = document.createElement("select");
    sortSelect.dataset.directorySort = "";
    const originalOption = document.createElement("option");
    originalOption.value = "";
    originalOption.textContent = "Original order";
    sortSelect.appendChild(originalOption);
    for (const sortDef of config.sortOptions) {
      const optionEl = document.createElement("option");
      optionEl.value = sortDef.key;
      optionEl.textContent = sortDef.label;
      sortSelect.appendChild(optionEl);
    }
    sortSelect.value = directoryControlsState.sortKey;
    sortSelect.addEventListener("change", () => {
      directoryControlsState.sortKey = sortSelect.value;
      refreshDirectoryView(config);
      writeDirectoryStateToUrl(config, directoryControlsState);
    });
    sortLabel.append(sortSpan, sortSelect);
    controlsRow.appendChild(sortLabel);

    const dirButton = document.createElement("button");
    dirButton.type = "button";
    dirButton.className = "button button-small button-secondary";
    dirButton.dataset.directorySortDir = "";
    dirButton.setAttribute("aria-label", "Sort direction");
    dirButton.textContent = directoryControlsState.dir === "desc" ? "Desc" : "Asc";
    dirButton.setAttribute("aria-pressed", String(directoryControlsState.dir === "desc"));
    dirButton.addEventListener("click", () => {
      directoryControlsState.dir = directoryControlsState.dir === "desc" ? "asc" : "desc";
      dirButton.textContent = directoryControlsState.dir === "desc" ? "Desc" : "Asc";
      dirButton.setAttribute("aria-pressed", String(directoryControlsState.dir === "desc"));
      refreshDirectoryView(config);
      writeDirectoryStateToUrl(config, directoryControlsState);
    });
    controlsRow.appendChild(dirButton);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "button button-small button-secondary";
    clearButton.textContent = "Clear filters";
    clearButton.dataset.directoryClear = "";
    clearButton.hidden = !isDirectoryStateActive(directoryControlsState);
    clearButton.addEventListener("click", () => {
      directoryControlsState = { q: "", filters: {}, sortKey: "", dir: "asc" };
      searchInput.value = "";
      for (const select of filterSelects) select.value = "";
      sortSelect.value = "";
      dirButton.textContent = "Asc";
      dirButton.setAttribute("aria-pressed", "false");
      refreshDirectoryView(config);
      writeDirectoryStateToUrl(config, directoryControlsState);
    });
    controlsRow.appendChild(clearButton);

    const countEl = document.createElement("p");
    countEl.className = "admin-toolbar-count";
    countEl.dataset.directoryCount = "";
    countEl.setAttribute("aria-live", "polite");

    container.append(controlsRow, countEl);
  }

  function renderDirectorySection(config, payload) {
    currentDirectoryRows = payload[config.dataKey] || [];
    const container = document.querySelector("[data-directory-controls]");
    if (container && container.dataset.built !== "true") {
      container.dataset.built = "true";
      directoryControlsState = readDirectoryStateFromUrl(config);
      buildToolbar(container, config, currentDirectoryRows);
    }
    refreshDirectoryView(config);
  }

  const DIRECTORY_CONFIG = {
    businesses: {
      selector: "[data-rows]",
      dataKey: "businesses",
      emptyText: "No businesses yet.",
      noMatchText: "No matching results. Clear filters to see all.",
      searchFields: ["name", "owner_email"],
      filters: [
        { key: "status", label: "Status", getValue: (r) => r.status },
        { key: "verification", label: "Verification", getValue: (r) => r.verification_status },
        { key: "risk", label: "Risk", getValue: (r) => r.risk_level },
      ],
      sortOptions: [
        { key: "created_at", label: "Created", type: "date" },
        { key: "name", label: "Business name", type: "text", getValue: (r) => r.name || r.id },
        { key: "status", label: "Status", type: "text" },
        { key: "risk_level", label: "Risk", type: "text" },
      ],
      columns: [
        { label: "Business", value: (r) => r.name || r.id },
        { label: "Owner", value: (r) => r.owner_email || "" },
        { label: "Status", value: (r) => statusCell(r.status) },
        { label: "Access", value: (r) => r.access_level || "" },
        { label: "Verification", value: (r) => statusCell(r.verification_status) },
        { label: "Risk", value: (r) => statusCell(r.risk_level) },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
        { label: "Actions", value: (r) => ({ href: `/admin/businesses/${r.id}`, text: "Manage" }) },
      ],
    },
    offers: {
      selector: "[data-rows]",
      dataKey: "offers",
      emptyText: "No offers yet.",
      noMatchText: "No matching results. Clear filters to see all.",
      searchFields: ["title", "business_name"],
      filters: [
        {
          key: "status",
          label: "Status",
          getValue: (r) => (r.is_active ? "live" : "inactive"),
          options: [
            { value: "live", label: "Live" },
            { value: "inactive", label: "Inactive" },
          ],
        },
      ],
      sortOptions: [
        { key: "created_at", label: "Created", type: "date" },
        { key: "start_time", label: "Starts", type: "date" },
        { key: "end_time", label: "Ends", type: "date" },
        { key: "status", label: "Status", type: "number", getValue: (r) => (r.is_active ? 1 : 0) },
      ],
      columns: [
        { label: "Offer", value: (r) => r.title || r.id },
        { label: "Business", value: (r) => r.business_name || r.business_id || "" },
        { label: "Status", value: (r) => ({ badge: r.is_active ? "Live" : "Inactive", tone: r.is_active ? "success" : "" }) },
        { label: "Starts", value: (r) => formatDateTime(r.start_time) },
        { label: "Ends", value: (r) => formatDateTime(r.end_time) },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ],
    },
    billing_events: {
      selector: "[data-rows]",
      dataKey: "billing_events",
      emptyText: "No billing events yet.",
      noMatchText: "No matching results. Clear filters to see all.",
      searchFields: ["event_type", "provider", "error_message"],
      filters: [
        { key: "status", label: "Processing status", getValue: (r) => r.processing_status },
        { key: "provider", label: "Provider", getValue: (r) => r.provider },
      ],
      sortOptions: [
        { key: "received_at", label: "Received", type: "date" },
        { key: "processed_at", label: "Processed", type: "date" },
        { key: "processing_status", label: "Status", type: "text" },
      ],
      columns: [
        { label: "Event", value: (r) => r.event_type || "" },
        { label: "Provider", value: (r) => r.provider || "" },
        { label: "Status", value: (r) => statusCell(r.processing_status) },
        { label: "Received", value: (r) => formatDateTime(r.received_at) },
        { label: "Processed", value: (r) => formatDateTime(r.processed_at) },
        { label: "Error", value: (r) => r.error_message || "" },
      ],
    },
    audit_log: {
      selector: "[data-rows]",
      dataKey: "audit_log",
      emptyText: "No audit events yet.",
      noMatchText: "No matching results. Clear filters to see all.",
      searchFields: ["action", "admin_email", "target_type", "reason"],
      filters: [
        { key: "action", label: "Action", getValue: (r) => r.action },
        { key: "target", label: "Target type", getValue: (r) => r.target_type },
      ],
      sortOptions: [
        { key: "created_at", label: "Created", type: "date" },
        { key: "action", label: "Action", type: "text" },
        { key: "admin_email", label: "Admin", type: "text" },
      ],
      columns: [
        { label: "Admin", value: (r) => r.admin_email || "" },
        { label: "Action", value: (r) => r.action || "" },
        { label: "Target", value: (r) => r.target_type || "" },
        { label: "Business", value: (r) => r.business_id || "" },
        { label: "Reason", value: (r) => r.reason || "" },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ],
    },
  };

  function detailBusinessId() {
    const fromQuery = new URLSearchParams(window.location.search).get("businessId");
    if (fromQuery) return fromQuery;
    const segments = window.location.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "";
    return /^[0-9a-f-]{36}$/i.test(last) ? last : "";
  }

  function renderSection(payload) {
    const directoryConfig = DIRECTORY_CONFIG[section];
    if (directoryConfig) {
      renderDirectorySection(directoryConfig, payload);
      return;
    }
    if (section === "settings") {
      fillTable("[data-launch-areas]", payload.launch_areas || [], [
        { label: "Area", value: (r) => r.name || "" },
        { label: "City", value: (r) => [r.city, r.state].filter(Boolean).join(", ") },
        { label: "Status", value: (r) => r.status || "" },
        { label: "Timezone", value: (r) => r.timezone || "" },
      ], "No launch areas configured.");
      fillTable("[data-feature-flags]", payload.feature_flags || [], [
        { label: "Flag", value: (r) => r.key || "" },
        { label: "Description", value: (r) => r.description || "" },
        { label: "Enabled", value: (r) => (r.enabled ? "On" : "Off") },
        { label: "Updated", value: (r) => formatDateTime(r.updated_at) },
      ], "No feature flags configured.");
      fillTable("[data-admin-users]", payload.admin_users || [], [
        { label: "Email", value: (r) => r.email || "" },
        { label: "Role", value: (r) => r.role || "" },
        { label: "Active", value: (r) => (r.is_active ? "Yes" : "No") },
        { label: "MFA", value: (r) => (r.require_mfa ? "Required" : "Optional") },
        { label: "Last login", value: (r) => formatDateTime(r.last_admin_login_at) },
      ], payload.admin_users_visible === false
        ? "Admin user management is visible to owner/admin roles only."
        : "No admin users found.");
      return;
    }
    if (section === "business_detail") {
      const business = payload.business;
      const nameEl = document.querySelector("[data-business-name]");
      const metaEl = document.querySelector("[data-business-meta]");
      if (nameEl) nameEl.textContent = business ? business.name || business.id : "Business not found";
      if (metaEl) {
        metaEl.textContent = business
          ? `Owner ${business.owner_email || "unknown"} | Status ${business.status || "unknown"} | Access ${business.access_level || "unknown"} | Verification ${business.verification_status || "unknown"} | Risk ${business.risk_level || "unknown"}`
          : "Check the link from the Businesses page and try again.";
      }
      fillTable("[data-applications]", payload.applications || [], [
        { label: "Contact", value: (r) => r.contact_name || "" },
        { label: "Email", value: (r) => r.email || "" },
        { label: "Status", value: (r) => statusCell(r.status) },
        { label: "Access", value: (r) => r.access_tier || "" },
        { label: "Trial days", value: (r) => r.trial_days ?? "" },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ], "No applications linked to this business.");
      fillTable("[data-audit]", payload.audit_log || [], [
        { label: "Admin", value: (r) => r.admin_email || "" },
        { label: "Action", value: (r) => r.action || "" },
        { label: "Reason", value: (r) => r.reason || "" },
        { label: "Created", value: (r) => formatDateTime(r.created_at) },
      ], "No audit events for this business.");
      renderBusinessDrilldown(payload);
      const viewOffersLink = document.querySelector("[data-view-offers-link]");
      if (viewOffersLink) {
        viewOffersLink.href = business?.name ? `/admin/offers?q=${encodeURIComponent(business.name)}` : "/admin/offers";
      }
    }
  }

  function renderBusinessDrilldown(payload) {
    const warningEl = document.querySelector("[data-drilldown-warning]");
    const hasError = Boolean(payload.business_health_error);
    if (warningEl) {
      warningEl.hidden = !hasError;
      warningEl.textContent = hasError
        ? "Business health details are temporarily unavailable. The rest of this business's record is still shown below."
        : "";
    }

    const health = payload.health || null;
    const healthLabelEl = document.querySelector("[data-health-label]");
    if (healthLabelEl) {
      healthLabelEl.textContent = health ? healthLabel(health.health_label) : "Unavailable";
      healthLabelEl.className = `admin-badge${health ? ` ${healthTone(health.health_label)}` : ""}`;
    }
    setText("[data-health-score]", health ? String(health.attention_score ?? 0) : "—");
    setText("[data-health-reason]", health?.primary_reason || "No health summary available.");
    const codesEl = document.querySelector("[data-health-codes]");
    if (codesEl) {
      const codes = health?.reason_codes || [];
      codesEl.hidden = !codes.length;
      codesEl.textContent = codes.length ? `Reason codes: ${codes.map(formatOptionLabel).join(", ")}` : "";
    }
    const nextStepEl = document.querySelector("[data-health-next-step]");
    if (nextStepEl) {
      nextStepEl.hidden = !health?.suggested_read_only_action;
      nextStepEl.textContent = health?.suggested_read_only_action
        ? `Suggested next step: ${health.suggested_read_only_action}`
        : "";
    }

    const offerActivity = payload.offer_activity || null;
    setText("[data-offer-live-count]", String(offerActivity?.live_offer_count ?? 0));
    setText("[data-offer-active-count]", String(offerActivity?.active_or_scheduled_offer_count ?? 0));
    const daysSince = offerActivity?.days_since_last_offer;
    setText("[data-offer-days-since]", daysSince === null || daysSince === undefined ? "—" : `${daysSince}d`);
    fillTable("[data-offer-rows]", offerActivity?.offers || [], [
      { label: "Offer", value: (r) => r.title || r.id || "" },
      { label: "Starts", value: (r) => formatDateTime(r.start_time) },
      { label: "Ends", value: (r) => formatDateTime(r.end_time) },
      { label: "Status", value: (r) => ({ badge: r.status === "live" ? "Live" : "Scheduled", tone: r.status === "live" ? "success" : "info" }) },
      { label: "Claims", value: (r) => r.claim_count ?? 0 },
      { label: "Redemptions", value: (r) => r.redemption_count ?? 0 },
    ], "No recent offers found.");

    const claimsAndRedemptions = payload.claims_and_redemptions || null;
    setText("[data-claims-7d]", String(claimsAndRedemptions?.claims_7d ?? 0));
    setText("[data-claims-30d]", String(claimsAndRedemptions?.claims_30d ?? 0));
    setText("[data-claims-unredeemed]", String(claimsAndRedemptions?.unredeemed_claims_30d ?? 0));
    setText("[data-redemptions-7d]", String(claimsAndRedemptions?.redemptions_7d ?? 0));
    setText("[data-redemptions-30d]", String(claimsAndRedemptions?.redemptions_30d ?? 0));
    setText(
      "[data-last-redeemed]",
      claimsAndRedemptions?.last_redeemed_at
        ? formatDateTime(claimsAndRedemptions.last_redeemed_at)
        : "No redemptions found in the current window.",
    );

    const trialAndAccess = payload.trial_and_access || null;
    const noTrialData = !trialAndAccess ||
      (!trialAndAccess.trial_request_status && !trialAndAccess.app_access_status && !trialAndAccess.trial_ends_at);
    const trialEmptyEl = document.querySelector("[data-trial-empty]");
    if (trialEmptyEl) trialEmptyEl.hidden = !noTrialData;
    setText("[data-trial-request-status]", trialAndAccess?.trial_request_status || "—");
    setText(
      "[data-trial-request-created]",
      trialAndAccess?.trial_request_created_at ? formatDateTime(trialAndAccess.trial_request_created_at) : "—",
    );
    setText("[data-app-access-status]", trialAndAccess?.app_access_status || "—");
    setText("[data-trial-ends]", trialAndAccess?.trial_ends_at ? formatDateTime(trialAndAccess.trial_ends_at) : "—");
    setText(
      "[data-trial-days-remaining]",
      trialAndAccess ? (formatTrialDays(trialAndAccess.trial_days_remaining) || "—") : "—",
    );

    const aiUsage = payload.ai_usage || null;
    setText("[data-ai-used]", String(aiUsage?.ai_month_used_max ?? 0));
    setText("[data-ai-limit]", String(aiUsage?.ai_month_limit_for_max ?? 0));
    setText("[data-ai-risk]", aiUsage ? formatAiRisk(aiUsage.ai_quota_risk) || "Normal" : "—");
    setText(
      "[data-ai-cost]",
      aiUsage?.ai_cost_available === true ? formatUsd(aiUsage.ai_month_cost_usd ?? 0) : "AI cost unavailable.",
    );
  }

  async function loadSection() {
    if (!summaryEndpoint || !section) return;
    const token = await getAccessToken();
    if (!token) {
      setStatus("Admin session not connected", "warning");
      return;
    }

    setStatus("Loading...");
    setTablesState("loading");
    const body = { section };
    if (section === "business_detail") body.business_id = detailBusinessId();

    try {
      const response = await fetch(summaryEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        clearSession();
        setStatus("Admin session expired. Sign in again.", "warning");
        setTablesState("expired");
        return;
      }
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Request failed");
      setStatus(`Signed in as ${payload.admin?.role || "admin"}`);
      renderSection(payload);
    } catch {
      setStatus("Could not load this page", "danger");
      setTablesState("error");
    }
  }

  if (signOutButton) {
    signOutButton.addEventListener("click", () => {
      clearSession();
      window.location.assign("/admin/login");
    });
  }

  function initBackToCommandCenterLink() {
    const backLink = document.querySelector("[data-back-to-command-center]");
    if (!backLink) return;
    const returnPath = new URLSearchParams(window.location.search).get("return");
    if (returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//")) {
      backLink.href = returnPath;
    }
  }

  syncNavForSession();
  initBackToCommandCenterLink();
  loadSection();
})();
