(() => {
  const SUPABASE_FN_BASE = "https://kvodhiqhdqnptqovovia.supabase.co/functions/v1";
  const ADMIN_PROXY_ENDPOINT = "/api/admin/proxy";
  const SESSION_ENDPOINT = "/api/admin/session";
  const TOKEN_KEYS = Object.freeze({});
  const REQUEST_TIMEOUT_MS = 20000;

  // Dataset key -> Edge Function name. Existing page scripts may continue to
  // read these keys while they are migrated to endpoint()/adminPost().
  const ENDPOINTS = {
    adminAuthEndpoint: "admin-auth-session",
    adminSummaryEndpoint: "admin-dashboard-summary",
    adminAiUsageEndpoint: "admin-ai-usage",
    adminAccountEndpoint: "admin-account-management",
    adminBusinessApplicationsEndpoint: "admin-business-applications",
    adminOnboardingReviewAiEndpoint: "admin-onboarding-review-ai",
    adminNameRequestsEndpoint: "admin-business-name-requests",
    adminReportsEndpoint: "admin-reports",
    adminPromoAuthorizationEndpoint: "admin-promo-authorization",
    adminQrCampaignsEndpoint: "admin-qr-campaigns",
    adminProspectImportEndpoint: "admin-prospect-import",
    adminProspectEnrichEndpoint: "admin-prospect-enrich",
    adminProspectScoreEndpoint: "admin-prospect-score",
    adminProspectSalesEndpoint: "admin-prospect-sales",
    adminSalesScriptEndpoint: "admin-sales-script",
    adminDemandProofEndpoint: "admin-demand-proof",
    adminClaimLinkEndpoint: "admin-claim-link-create",
    adminClaimLinkAssistantEndpoint: "admin-claim-link-assistant",
    adminTrialFromProspectEndpoint: "admin-trial-create-from-prospect",
    adminTrialConversionAssistantEndpoint: "admin-trial-conversion-assistant",
    adminAiPromptsEndpoint: "admin-ai-prompts",
    adminAiOperatingReportEndpoint: "admin-ai-operating-report",
    adminAiCostLedgerResetEndpoint: "admin-ai-cost-ledger-reset",
    adminOwnerEmailEndpoint: "admin-owner-email",
  };

  const NAV_GROUPS = [
    {
      label: "Overview",
      items: [
        { href: "/admin", label: "Dashboard", icon: "⌂" },
        { href: "/admin#action-queue", label: "Action Queue", icon: "!" },
      ],
    },
    {
      label: "Operations",
      items: [
        { href: "/admin/businesses", label: "Businesses", icon: "B" },
        { href: "/admin/offers", label: "Offers", icon: "O" },
        { href: "/admin/offers?view=redemptions", label: "Redemptions", icon: "R" },
        { href: "/admin/accounts", label: "Customers", icon: "C" },
        { href: "/admin/reports", label: "Reports", icon: "!" },
      ],
    },
    {
      label: "Support",
      items: [
        { href: "/admin/account-repair", label: "Account Repair", icon: "+" },
        { href: "/admin/communications", label: "Communications", icon: "@" },
      ],
    },
    {
      label: "Finance & AI",
      items: [
        { href: "/admin/billing/events", label: "Billing", icon: "$" },
        { href: "/admin/ai-usage", label: "AI Usage", icon: "A" },
      ],
    },
    {
      label: "Advanced",
      collapsible: true,
      items: [
        { href: "/admin/trial-requests", label: "Business Access", icon: "✓" },
        { href: "/admin/prospects", label: "Prospects", icon: "P" },
        { href: "/admin/sales-ai", label: "Sales AI", icon: "S" },
        { href: "/admin/qr-campaigns", label: "QR Campaigns", icon: "Q" },
        { href: "/admin/ai-prompts", label: "Prompts", icon: "P" },
        { href: "/admin/ai-operating-report", label: "AI Report", icon: "A" },
        { href: "/admin/audit-log", label: "Audit Log", icon: "L" },
        { href: "/admin/settings", label: "Settings", icon: "S" },
        { href: "/admin/settings#system-health", label: "System Health", icon: "H" },
      ],
    },
  ];

  const MOBILE_NAV = [
    { href: "/admin", label: "Home", icon: "⌂" },
    { href: "/admin/businesses", label: "Businesses", icon: "B" },
    { href: "/admin/offers", label: "Offers", icon: "O" },
    { href: "/admin/account-repair", label: "Fix Account", icon: "+" },
  ];

  let sessionAvailable = false;
  let sessionCheckPromise = null;

  function endpoint(name) {
    return `${ADMIN_PROXY_ENDPOINT}?function=${encodeURIComponent(String(name || "").replace(/^\/+/, ""))}`;
  }

  function storageSource() {
    return window.sessionStorage;
  }

  function hasStoredToken() {
    return sessionAvailable;
  }

  function storeSession() {
    sessionAvailable = true;
    syncSessionActions();
  }

  async function clearSession() {
    sessionAvailable = false;
    await fetch(SESSION_ENDPOINT, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => {});
    syncSessionActions();
  }

  function loginUrl() {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return `/admin/login/?next=${encodeURIComponent(next)}`;
  }

  function redirectToLogin() {
    window.location.assign(loginUrl());
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function ensureSession() {
    if (sessionAvailable) return true;
    if (sessionCheckPromise) return sessionCheckPromise;
    sessionCheckPromise = (async () => {
      const response = await fetchWithTimeout(SESSION_ENDPOINT, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await readJson(response);
      sessionAvailable = response.ok && payload.authenticated === true;
      syncSessionActions();
      return sessionAvailable;
    })();
    try {
      return await sessionCheckPromise;
    } finally {
      sessionCheckPromise = null;
    }
  }

  async function getAccessToken() {
    return await ensureSession() ? "cookie-session" : null;
  }

  async function adminPost(fnName, body = {}, options = {}) {
    const token = await getAccessToken();
    if (!token) {
      if (options.redirect !== false) redirectToLogin();
      throw new Error("Admin session not connected.");
    }
    const url = /^https?:\/\//i.test(fnName) || String(fnName).startsWith("/")
      ? fnName
      : endpoint(fnName);
    let response;
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Authorization: "Bearer cookie-session",
            "Content-Type": "application/json",
            ...(options.headers || {}),
          },
          body: JSON.stringify(body),
        },
        options.timeoutMs || REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(options.timeoutMessage || "The admin request timed out. Try again.");
      }
      throw new Error(options.networkMessage || "Could not reach the admin service.");
    }
    const payload = await readJson(response);
    if (response.status === 401) {
      await clearSession();
      if (options.redirect !== false) redirectToLogin();
      throw new Error(payload.error || "Admin session expired.");
    }
    if (response.status === 403) {
      throw new Error(payload.error || "Admin authorization was denied.");
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || options.errorMessage || "Admin request failed.");
    }
    return payload;
  }

  function stampEndpoints(root = document) {
    const targets = new Set();
    if (document.body) targets.add(document.body);
    for (const node of root.querySelectorAll?.("[data-admin-app], [data-admin-config]") || []) {
      targets.add(node);
    }
    for (const target of targets) {
      for (const [key, fnName] of Object.entries(ENDPOINTS)) {
        if (!target.dataset[key]) target.dataset[key] = endpoint(fnName);
      }
    }
  }

  function normalizedPath(value) {
    return String(value || "").replace(/\/+$/, "") || "/";
  }

  function isCurrent(href) {
    const current = normalizedPath(window.location.pathname);
    const target = new URL(href, window.location.origin);
    const targetPath = normalizedPath(target.pathname);
    if (targetPath === "/admin") return current === "/admin";
    if (targetPath === "/admin/offers" && target.searchParams.get("view") === "redemptions") {
      return current === targetPath
        && new URLSearchParams(window.location.search).get("view") === "redemptions";
    }
    if (targetPath === "/admin/settings" && target.hash === "#system-health") {
      return current === targetPath && window.location.hash === target.hash;
    }
    if (targetPath === "/admin/accounts" && current === "/admin/account-repair") return false;
    return current === targetPath || current.startsWith(`${targetPath}/`);
  }

  function makeNavLink(item, compact = false) {
    const link = document.createElement("a");
    link.href = item.href;
    link.className = compact ? "admin-bottom-nav-link" : "admin-sidebar-link";
    if (isCurrent(item.href)) link.setAttribute("aria-current", "page");
    const icon = document.createElement("span");
    icon.className = "admin-nav-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.textContent = item.label;
    link.append(icon, label);
    return link;
  }

  function buildSidebar() {
    const aside = document.createElement("aside");
    aside.className = "admin-sidebar";
    aside.dataset.adminSidebar = "";
    aside.setAttribute("aria-label", "Admin navigation");

    const brand = document.createElement("a");
    brand.className = "admin-sidebar-brand";
    brand.href = "/admin";
    brand.innerHTML = '<span class="brand-mark" aria-hidden="true"><img src="/assets/twofer-mark.png" alt="" /></span><span><strong>Twofer</strong><small>Operations</small></span>';
    aside.appendChild(brand);

    const nav = document.createElement("nav");
    nav.className = "admin-sidebar-nav";
    for (const group of NAV_GROUPS) {
      const section = group.collapsible ? document.createElement("details") : document.createElement("section");
      section.className = "admin-nav-group";
      if (group.collapsible) {
        section.open = group.items.some((item) => isCurrent(item.href));
        const summary = document.createElement("summary");
        summary.textContent = group.label;
        section.appendChild(summary);
      } else {
        const heading = document.createElement("p");
        heading.className = "admin-nav-group-label";
        heading.textContent = group.label;
        section.appendChild(heading);
      }
      const links = document.createElement("div");
      links.className = "admin-nav-group-links";
      for (const item of group.items) links.appendChild(makeNavLink(item));
      section.appendChild(links);
      nav.appendChild(section);
    }
    aside.appendChild(nav);
    return aside;
  }

  function buildBottomNav() {
    const nav = document.createElement("nav");
    nav.className = "admin-bottom-nav";
    nav.dataset.adminBottomNav = "";
    nav.setAttribute("aria-label", "Admin mobile navigation");
    for (const item of MOBILE_NAV) nav.appendChild(makeNavLink(item, true));
    const more = document.createElement("button");
    more.type = "button";
    more.className = "admin-bottom-nav-link";
    more.dataset.adminMoreToggle = "";
    more.setAttribute("aria-expanded", "false");
    more.innerHTML = '<span class="admin-nav-icon" aria-hidden="true">•••</span><span>More</span>';
    nav.appendChild(more);
    return nav;
  }

  function shellRoot() {
    return document.querySelector("[data-admin-app]") || document.body;
  }

  function renderNav() {
    const root = shellRoot();
    if (!root || normalizedPath(window.location.pathname) === "/admin/login") return;
    root.querySelectorAll(".nav-links").forEach((node) => node.remove());
    if (!hasStoredToken()) {
      root.querySelector("[data-admin-sidebar]")?.remove();
      root.querySelector("[data-admin-bottom-nav]")?.remove();
      return;
    }
    if (root.dataset.adminShellReady === "true") return;

    const header = root.querySelector(":scope > .site-header");
    const main = root.querySelector(":scope > .admin-main");
    if (!header || !main) return;

    const layout = document.createElement("div");
    layout.className = "admin-layout";
    const page = document.createElement("div");
    page.className = "admin-page-column";
    root.insertBefore(layout, header);
    layout.append(buildSidebar(), page);
    page.append(header, main);
    root.appendChild(buildBottomNav());
    root.dataset.adminShellReady = "true";
    document.body.classList.add("admin-shell-ready");
  }

  function syncSessionActions() {
    const hasToken = hasStoredToken();
    document.querySelectorAll("[data-admin-login-link]").forEach((node) => {
      node.hidden = hasToken;
    });
    document.querySelectorAll("[data-admin-sign-out]").forEach((node) => {
      node.hidden = !hasToken;
      if (!node.dataset.adminShellBound) {
        node.dataset.adminShellBound = "true";
        node.addEventListener("click", async () => {
          await clearSession();
          window.location.assign("/admin/login");
        });
      }
    });
    renderNav();
  }

  function openMobileNav() {
    const sidebar = document.querySelector("[data-admin-sidebar]");
    const toggle = document.querySelector("[data-admin-more-toggle]");
    if (!sidebar || !toggle) return;
    const open = !sidebar.classList.contains("is-open");
    sidebar.classList.toggle("is-open", open);
    document.body.classList.toggle("admin-mobile-nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  function bindShellActions() {
    document.addEventListener("click", (event) => {
      const toggle = event.target.closest?.("[data-admin-more-toggle]");
      if (toggle) {
        openMobileNav();
        return;
      }
      if (
        document.body.classList.contains("admin-mobile-nav-open")
        && !event.target.closest?.("[data-admin-sidebar]")
      ) {
        openMobileNav();
      }
    });
  }

  function hydrate(root = document) {
    stampEndpoints(root);
    syncSessionActions();
  }

  window.TwoferAdminShell = {
    SUPABASE_FN_BASE,
    REQUEST_TIMEOUT_MS,
    TOKEN_KEYS,
    endpoint,
    storageSource,
    hasStoredToken,
    storeSession,
    clearSession,
    getAccessToken,
    adminPost,
    readJson,
    renderNav,
    syncSessionActions,
    hydrate,
    async signOut() {
      await clearSession();
      window.location.assign("/admin/login");
    },
  };

  bindShellActions();
  hydrate();
  if (normalizedPath(window.location.pathname) !== "/admin/login") {
    ensureSession().then((available) => {
      if (!available) redirectToLogin();
    }).catch(() => redirectToLogin());
  }
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length)) hydrate();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
