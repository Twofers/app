(() => {
  const Shell = window.TwoferAdminShell;

  function humanize(value) {
    return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function inject() {
    if (document.querySelector("[data-owner-view]")) return;
    const view = document.createElement("section");
    view.className = "admin-owner-view";
    view.dataset.ownerView = "";
    view.hidden = true;
    view.innerHTML = `
      <div class="admin-owner-view-banner">
        <strong data-owner-view-banner>Viewing as business owner</strong>
        <button class="button button-small" type="button" data-owner-view-exit>Exit owner view</button>
      </div>
      <div class="admin-owner-view-content">
        <div data-owner-view-banners></div>
        <header class="admin-owner-view-business"><p class="admin-kicker">Read-only owner picture</p><h1 data-owner-view-title>Business</h1><p data-owner-view-meta></p></header>
        <div class="admin-grid three">
          <article class="admin-card"><span>Total claims</span><strong data-owner-view-claims>0</strong></article>
          <article class="admin-card"><span>Total redemptions</span><strong data-owner-view-redemptions>0</strong></article>
          <article class="admin-card"><span>Access</span><strong data-owner-view-access>—</strong></article>
        </div>
        <section class="admin-section"><h2>Your offers</h2><div class="admin-owner-offer-list" data-owner-view-offers></div></section>
      </div>
    `;
    document.body.appendChild(view);
    view.querySelector("[data-owner-view-exit]").addEventListener("click", close);
  }

  function close() {
    const view = document.querySelector("[data-owner-view]");
    if (!view) return;
    view.hidden = true;
    document.body.classList.remove("is-owner-viewing");
  }

  function render(payload) {
    const view = document.querySelector("[data-owner-view]");
    const owner = payload.owner_view;
    const business = owner.business;
    view.querySelector("[data-owner-view-banner]").textContent = `Viewing as ${business.name} — read-only`;
    view.querySelector("[data-owner-view-title]").textContent = business.name;
    view.querySelector("[data-owner-view-meta]").textContent = [business.category, humanize(business.verification_status)].filter(Boolean).join(" · ");
    view.querySelector("[data-owner-view-claims]").textContent = String(owner.claims?.total || 0);
    view.querySelector("[data-owner-view-redemptions]").textContent = String(owner.claims?.redemptions || 0);
    view.querySelector("[data-owner-view-access]").textContent = humanize(owner.subscription?.app_access_status || "not activated");
    const banners = view.querySelector("[data-owner-view-banners]");
    banners.textContent = "";
    for (const item of owner.banners || []) {
      const banner = document.createElement("p");
      banner.className = `status ${item.tone === "danger" ? "error" : item.tone || ""}`;
      banner.textContent = item.message;
      banners.appendChild(banner);
    }
    const offers = view.querySelector("[data-owner-view-offers]");
    offers.textContent = "";
    for (const offer of owner.offers || []) {
      const card = document.createElement("article");
      card.className = "admin-owner-offer-card";
      const heading = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = offer.title || "Untitled offer";
      const status = document.createElement("span");
      status.className = `admin-badge${offer.status === "live" ? " success" : ""}`;
      status.textContent = humanize(offer.status);
      heading.append(title, status);
      const detail = document.createElement("p");
      detail.textContent = `${Number(offer.claim_count || 0)} claims · ${Number(offer.redemption_count || 0)} redemptions`;
      card.append(heading, detail);
      offers.appendChild(card);
    }
    if (!offers.children.length) {
      const empty = document.createElement("p");
      empty.className = "admin-note";
      empty.textContent = "You have not created an offer yet.";
      offers.appendChild(empty);
    }
  }

  async function open(options = {}) {
    const businessId = String(options.businessId || "");
    if (!businessId) return;
    inject();
    const view = document.querySelector("[data-owner-view]");
    view.hidden = false;
    document.body.classList.add("is-owner-viewing");
    view.querySelector("[data-owner-view-title]").textContent = "Loading owner picture…";
    try {
      const payload = await Shell.adminPost("admin-dashboard-summary", {
        section: "owner_view",
        business_id: businessId,
      });
      render(payload);
    } catch (error) {
      view.querySelector("[data-owner-view-title]").textContent = error.message || "Could not load owner view.";
    }
  }

  window.TwoferOwnerView = { open, close };
  inject();
})();
