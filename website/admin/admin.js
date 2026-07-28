(() => {
  const Shell = window.TwoferAdminShell;
  const reasonCopy = {
    live_offers_no_redemptions: {
      explanation: "Live offers have not produced a redemption in the last 30 days.",
      why: "The business may need help with offer clarity, staff readiness, or customer follow-through.",
      action: "Review the live offer and redemption setup with the owner.",
    },
    claims_no_redemptions: {
      explanation: "Customers are claiming offers but none have been redeemed in the last 30 days.",
      why: "Unredeemed claims can point to staff confusion or friction at the counter.",
      action: "Check the redemption flow and confirm staff know how to complete it.",
    },
    pending_trial_request: {
      explanation: "A business access request is still waiting for review.",
      why: "The owner cannot continue setup until the request is handled.",
      action: "Review the request and record the next setup decision.",
    },
    trial_ending_soon: {
      explanation: "The active trial has seven days or less remaining.",
      why: "The owner may lose access before billing or a next-step decision is settled.",
      action: "Confirm billing and the owner's post-trial plan.",
    },
    no_recent_offers: {
      explanation: "This active business has not created an offer in at least 14 days.",
      why: "Customers have nothing current to claim and the owner may need setup help.",
      action: "Review the business setup and help the owner publish a useful offer.",
    },
    ai_quota_high: {
      explanation: "AI usage is close to the business's monthly quota.",
      why: "The owner may be blocked from creating the next offer.",
      action: "Review AI usage and decide whether support or a quota reset is appropriate.",
    },
    ai_cost_high: {
      explanation: "This business has reached the current high-cost review threshold for the month.",
      why: "Unexpected generation loops can consume the operating budget quickly.",
      action: "Review recent AI activity before more generation work continues.",
    },
  };

  let queueItems = [];
  let activeQueueFilter = "all";
  let activeQueueStatusFilter = "active";
  let businessHealthTotal = 0;
  let queueStatusEnabled = false;

  function setStatus(message, tone = "info") {
    const node = document.querySelector("[data-admin-status]");
    if (!node) return;
    node.textContent = message;
    node.className = `admin-badge${tone === "danger" ? " danger" : tone === "warning" ? " warning" : tone === "success" ? " success" : ""}`;
  }

  function formatUsd(value) {
    return Number(value || 0).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatDate(value, options = {}) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return date.toLocaleString(undefined, options);
  }

  function relativeWaiting(value) {
    if (!value) return "Now";
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "Now";
    const days = Math.max(0, Math.floor((Date.now() - time) / 86400000));
    if (days === 0) return "Today";
    if (days === 1) return "1 day";
    return `${days} days`;
  }

  function humanize(value) {
    return String(value || "unknown")
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function setMetric(key, value, detail) {
    const metric = document.querySelector(`[data-ops-metric="${key}"]`);
    const detailNode = document.querySelector(`[data-ops-metric-detail="${key}"]`);
    const card = document.querySelector(`[data-ops-metric-card="${key}"]`);
    if (metric) metric.textContent = String(value);
    if (detailNode) detailNode.textContent = detail;
    const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""));
    if (card) card.classList.toggle("is-zero", Number.isFinite(numeric) && numeric === 0);
  }

  function nodeWithText(tag, text, className = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function addCell(row, label, value) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (value instanceof Node) cell.appendChild(value);
    else cell.textContent = String(value ?? "");
    row.appendChild(cell);
  }

  function badge(text, tone = "") {
    return nodeWithText("span", text, `admin-badge${tone ? ` ${tone}` : ""}`);
  }

  function contactOwnerButton(businessId, reason = "account_support") {
    const button = nodeWithText("button", "Draft email", "button button-small button-secondary");
    button.type = "button";
    button.disabled = !businessId;
    button.addEventListener("click", () => {
      window.TwoferOwnerEmail?.open({ businessId, reason });
    });
    return button;
  }

  function ownerViewButton(businessId) {
    const button = nodeWithText("button", "View as owner", "button button-small button-secondary");
    button.type = "button";
    button.disabled = !businessId;
    button.addEventListener("click", () => window.TwoferOwnerView?.open({ businessId }));
    return button;
  }

  function primaryReasonCode(row) {
    return (row.reason_codes || []).find((code) => reasonCopy[code]) || "";
  }

  function renderServiceAlerts(rows) {
    const section = document.querySelector("[data-service-alerts-section]");
    const list = document.querySelector("[data-service-alerts]");
    if (!section || !list) return;
    const alerts = rows
      .filter((row) => row.health_label === "needs_attention")
      .sort((left, right) => Number(right.attention_score || 0) - Number(left.attention_score || 0))
      .slice(0, 6);
    section.hidden = alerts.length === 0;
    list.textContent = "";
    for (const row of alerts) {
      const code = primaryReasonCode(row);
      const copy = reasonCopy[code] || {
        explanation: row.primary_reason || "This business has an operating signal that needs review.",
        why: "Reviewing it now can prevent an owner or customer from getting stuck.",
        action: row.suggested_read_only_action || "Review the business activity.",
      };
      const article = document.createElement("article");
      article.className = "admin-service-alert";
      const content = document.createElement("div");
      content.appendChild(nodeWithText("h3", `${row.business_name || "Business"} — ${row.primary_reason || "Needs attention"}`));
      content.appendChild(nodeWithText("p", copy.explanation));
      const why = document.createElement("p");
      why.append(nodeWithText("strong", "Why it matters: "), document.createTextNode(copy.why));
      content.appendChild(why);
      const next = document.createElement("p");
      next.append(nodeWithText("strong", "Recommended: "), document.createTextNode(copy.action));
      content.appendChild(next);
      const button = nodeWithText("button", "Review business", "button button-small");
      button.type = "button";
      button.addEventListener("click", () => openBusinessPanel(row.business_id || row.id, row.business_name));
      const actions = document.createElement("div");
      actions.className = "admin-inline-actions";
      actions.appendChild(button);
      actions.appendChild(ownerViewButton(row.business_id || row.id));
      actions.appendChild(contactOwnerButton(row.business_id || row.id, healthCategory(row) === "billing" ? "billing_setup" : healthCategory(row) === "redemptions" ? "redemption_help" : "offer_help"));
      if (queueStatusEnabled) {
        const dismiss = nodeWithText("button", "Dismiss", "button button-small button-secondary");
        dismiss.type = "button";
        dismiss.addEventListener("click", async () => {
          dismiss.disabled = true;
          try {
            const businessId = row.business_id || row.id;
            const code = primaryReasonCode(row) || "health_review";
            await Shell.adminPost("admin-dashboard-summary", {
              section: "queue_status",
              action: "set",
              issue_key: `${code}:${businessId}`,
              business_id: businessId,
              status: "dismissed",
              note: "Dismissed from the service alert.",
            });
            article.remove();
            if (!list.children.length) section.hidden = true;
          } catch (error) {
            dismiss.textContent = error.message || "Could not dismiss";
            dismiss.disabled = false;
          }
        });
        actions.appendChild(dismiss);
      }
      article.append(content, actions);
      list.appendChild(article);
    }
  }

  function healthCategory(row) {
    const codes = row.reason_codes || [];
    if (codes.includes("pending_trial_request")) return "setup";
    if (codes.some((code) => code.includes("redemptions"))) return "redemptions";
    if (codes.includes("no_recent_offers")) return "offers";
    if (codes.some((code) => code.startsWith("ai_"))) return "ai";
    if (codes.includes("trial_ending_soon")) return "billing";
    return "accounts";
  }

  function countQueue(summary) {
    return [
      {
        key: "open-trial-requests",
        count: summary.trialRequests?.open,
        category: "setup",
        priority: 90,
        title: "Business access requests waiting for review",
        explanation: "Owners cannot continue setup until these requests are reviewed.",
        href: "/admin/trial-requests",
      },
      {
        key: "pending-verification",
        count: summary.businesses?.pendingVerification,
        category: "setup",
        priority: 82,
        title: "Businesses waiting for verification",
        explanation: "Verification gaps can block a business from going fully live.",
        href: "/admin/businesses?status=pending_verification",
      },
      {
        key: "failed-billing-events",
        count: summary.billing?.stripeWebhookErrors,
        category: "billing",
        priority: 88,
        title: "Failed billing events",
        explanation: "Billing sync failures may affect owner access or payment status.",
        href: "/admin/billing/events?status=failed",
      },
      {
        key: "open-reports",
        count: summary.moderation?.openReports,
        category: "reports",
        priority: 76,
        title: "Customer reports waiting for review",
        explanation: "Reported businesses, offers, or customers need an operator decision.",
        href: "/admin/reports",
      },
      {
        key: "offers-needing-review",
        count: summary.offers?.needsReview,
        category: "offers",
        priority: 72,
        title: "Offers needing review",
        explanation: "Owner-created offers may need moderation or setup support.",
        href: "/admin/offers?status=review",
      },
    ]
      .filter((item) => Number(item.count || 0) > 0)
      .map((item) => ({
        ...item,
        business_name: `${Number(item.count).toLocaleString()} item${Number(item.count) === 1 ? "" : "s"}`,
        waiting_since: null,
        status: "new",
      }));
  }

  function buildQueue(summary, healthRows) {
    const healthItems = healthRows
      .filter((row) => Number(row.attention_score || 0) > 0)
      .map((row) => ({
        key: `business-health:${row.business_id || row.id}`,
        category: healthCategory(row),
        priority: Number(row.attention_score || 0),
        title: row.primary_reason || "Business health review",
        explanation: reasonCopy[primaryReasonCode(row)]?.action || row.suggested_read_only_action || "Review business activity.",
        business_id: row.business_id || row.id,
        business_name: row.business_name || "Business",
        waiting_since: row.trial_request_created_at || row.last_offer_at || null,
        href: `/admin/businesses/detail?businessId=${encodeURIComponent(row.business_id || row.id || "")}`,
        status: "New",
      }));
    return [...healthItems, ...countQueue(summary)].sort((left, right) => {
      const priority = Number(right.priority || 0) - Number(left.priority || 0);
      if (priority) return priority;
      return new Date(left.waiting_since || 0).getTime() - new Date(right.waiting_since || 0).getTime();
    });
  }

  function renderQueue() {
    const body = document.querySelector("[data-action-queue-body]");
    const count = document.querySelector("[data-queue-count]");
    const section = document.querySelector("[data-action-queue-section]");
    if (!body || !count) return;
    document.querySelectorAll("[data-queue-filter]").forEach((button) => {
      const category = button.dataset.queueFilter;
      const categoryCount = category === "all"
        ? queueItems.length
        : queueItems.filter((item) => item.category === category).length;
      button.hidden = category !== "all" && categoryCount === 0;
      const countNode = button.querySelector("[data-queue-filter-count]");
      if (countNode) countNode.textContent = String(categoryCount);
    });
    const visible = queueItems.filter((item) => {
      if (activeQueueFilter !== "all" && item.category !== activeQueueFilter) return false;
      if (activeQueueStatusFilter === "all") return true;
      if (activeQueueStatusFilter === "active") {
        return item.status !== "resolved" && item.status !== "dismissed";
      }
      return item.status === activeQueueStatusFilter;
    });
    const capNote = activeQueueFilter === "all" && businessHealthTotal > 50
      ? ` • health signals show 50 of ${businessHealthTotal.toLocaleString()}`
      : "";
    count.textContent = `${visible.length.toLocaleString()} queue item${visible.length === 1 ? "" : "s"}${capNote}`;
    if (section) section.hidden = queueItems.length === 0;
    body.textContent = "";
    if (!visible.length) {
      const row = document.createElement("tr");
      const cell = nodeWithText("td", "Nothing in this category needs attention.", "admin-row-detail");
      cell.colSpan = 7;
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    for (const item of visible) {
      const row = document.createElement("tr");
      addCell(row, "Priority", nodeWithText("span", String(item.priority), `admin-priority${item.priority >= 70 ? " high" : ""}`));
      addCell(row, "Category", humanize(item.category));
      const issue = document.createElement("div");
      issue.append(nodeWithText("strong", item.title), nodeWithText("p", item.explanation, "admin-note"));
      addCell(row, "Issue", issue);
      addCell(row, "Business", item.business_name || "Multiple");
      addCell(row, "Waiting", relativeWaiting(item.waiting_since));
      if (item.persistent) {
        const status = document.createElement("select");
        status.className = "admin-queue-status-select";
        status.setAttribute("aria-label", `Workflow status for ${item.title}`);
        for (const value of ["new", "reviewing", "waiting_owner", "resolved", "dismissed"]) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = humanize(value === "waiting_owner" ? "waiting on owner" : value);
          option.selected = item.status === value;
          status.appendChild(option);
        }
        status.addEventListener("change", () => updateQueueStatus(item, status.value, status));
        addCell(row, "Status", status);
      } else {
        addCell(row, "Status", badge(humanize(item.status), "warning"));
      }
      if (item.business_id) {
        const actions = document.createElement("div");
        actions.className = "admin-inline-actions";
        const action = nodeWithText("button", "Review", "button button-small button-secondary");
        action.type = "button";
        action.addEventListener("click", () => openBusinessPanel(item.business_id, item.business_name));
        actions.append(action, ownerViewButton(item.business_id), contactOwnerButton(item.business_id, item.category === "billing" ? "billing_setup" : item.category === "redemptions" ? "redemption_help" : "account_support"));
        addCell(row, "Action", actions);
      } else {
        const action = nodeWithText("a", "Open queue", "button button-small button-secondary");
        action.href = item.href;
        addCell(row, "Action", action);
      }
      body.appendChild(row);
    }
  }

  async function updateQueueStatus(item, status, select) {
    const previous = item.status;
    let note = item.note || "";
    if (["waiting_owner", "resolved", "dismissed"].includes(status)) {
      const entered = window.prompt("Optional note for this workflow change:", note);
      if (entered === null) {
        select.value = previous;
        return;
      }
      note = entered.trim();
    }
    select.disabled = true;
    try {
      const payload = await Shell.adminPost("admin-dashboard-summary", {
        section: "queue_status",
        action: "set",
        issue_key: item.key,
        business_id: item.business_id,
        status,
        note,
      });
      item.status = payload.queue_status?.status || status;
      item.note = payload.queue_status?.note || note;
      renderQueue();
    } catch (error) {
      select.value = previous;
      window.alert(error.message || "Could not update the queue status.");
    } finally {
      select.disabled = false;
    }
  }

  function renderMetrics(summary) {
    const activity = summary.activity || {};
    const claims = Number(activity.claimsToday || 0);
    const redemptions = Number(activity.redemptionsToday || 0);
    const rate = claims > 0 ? `${Math.round((redemptions / claims) * 100)}% claim-to-redeem today` : "No claims today";
    const hasV2 = Boolean(summary.deals && summary.redemptions && summary.users);
    setMetric(
      "deals",
      Number(summary.deals?.liveNow ?? summary.offers?.live ?? 0),
      hasV2
        ? `${Number(summary.deals?.created7d || 0).toLocaleString()} created in the last 7 days`
        : "Live offers now",
    );
    setMetric(
      "redemptions",
      Number(summary.redemptions?.last7d ?? redemptions),
      summary.redemptions
        ? `${Number(summary.redemptions.today || 0).toLocaleString()} today • ${Math.round(Number(summary.redemptions.claimToRedeemRate30d || 0) * 100)}% claim-to-redeem in 30 days`
        : `${rate} • 7-day total arrives with summary v2`,
    );
    setMetric(
      "users",
      Number(summary.users?.active30d ?? activity.newConsumersThisWeek ?? 0),
      summary.users?.active30d === undefined ? "New customers this week" : "Active in the last 30 days",
    );
    const activeUsersDefinition = document.querySelector("[data-active-users-definition]");
    const activeUsersDefinitionWrap = document.querySelector("[data-active-users-definition-wrap]");
    if (activeUsersDefinition) {
      activeUsersDefinition.textContent = summary.users?.definition || "";
    }
    if (activeUsersDefinitionWrap) activeUsersDefinitionWrap.hidden = !summary.users?.definition;
    setMetric(
      "businesses",
      Number(summary.businesses?.withLiveOffer ?? summary.businesses?.active ?? 0),
      summary.businesses?.withLiveOffer === undefined
        ? "Active total; businesses with a live offer arrives with summary v2"
        : `${Number(summary.businesses?.active || 0).toLocaleString()} active total`,
    );
    const perDeal = summary.apiSpend?.perGeneratedDealUsd;
    const budget = summary.apiSpend?.budgetMonthlyUsd;
    setMetric(
      "ai",
      formatUsd(summary.apiSpend?.currentMonthUsd || 0),
      `${formatUsd(summary.apiSpend?.priorMonthUsd || 0)} prior month${perDeal === undefined ? "" : ` • ${formatUsd(perDeal)} per generated deal`}`,
    );
    if (budget !== null && budget !== undefined) {
      const aiDetail = document.querySelector('[data-ops-metric-detail="ai"]');
      if (aiDetail) aiDetail.textContent += ` · ${formatUsd(budget)} monthly budget`;
    }
  }

  const accountGrowthPeriods = ["day", "week", "month"];

  function accountGrowthTrend(currentValue, previousValue) {
    const current = Number(currentValue || 0);
    const previous = Number(previousValue || 0);
    const delta = current - previous;
    if (delta === 0) return { text: "No change", tone: "" };
    if (delta > 0 && previous === 0) {
      return { text: `Up +${delta.toLocaleString()} (new)`, tone: "success" };
    }
    const percent = Math.round((Math.abs(delta) / Math.max(previous, 1)) * 100);
    return {
      text: `${delta > 0 ? "Up" : "Down"} ${delta > 0 ? "+" : "-"}${Math.abs(delta).toLocaleString()} (${percent}%)`,
      tone: delta > 0 ? "success" : "danger",
    };
  }

  function renderAccountGrowth(accounts, errorMessage = "") {
    const grid = document.querySelector("[data-account-growth-grid]");
    const status = document.querySelector("[data-account-growth-status]");
    const monthSummary = document.querySelector("[data-account-growth-month-summary]");
    const balance = document.querySelector("[data-account-growth-balance]");
    const definition = document.querySelector("[data-account-growth-definition]");
    const hasData = accounts && typeof accounts === "object" && accounts.customers && accounts.businesses && accounts.combined;

    if (!hasData) {
      if (grid) grid.hidden = true;
      if (status) {
        status.hidden = false;
        status.textContent = errorMessage || "Account growth is temporarily unavailable.";
      }
      if (monthSummary) {
        monthSummary.textContent = "Growth unavailable";
        monthSummary.className = "admin-badge warning";
      }
      if (balance) balance.hidden = true;
      return;
    }

    if (grid) grid.hidden = false;
    if (status) status.hidden = true;
    if (definition && accounts.definition) definition.textContent = accounts.definition;

    const combinedTotal = Number(accounts.combined.total || 0);
    for (const segment of ["customers", "businesses"]) {
      const metrics = accounts[segment] || {};
      const total = Number(metrics.total || 0);
      const totalNode = document.querySelector(`[data-account-growth-total="${segment}"]`);
      const shareNode = document.querySelector(`[data-account-growth-share="${segment}"]`);
      if (totalNode) totalNode.textContent = total.toLocaleString();
      if (shareNode) {
        const share = combinedTotal > 0 ? Math.round((total / combinedTotal) * 100) : 0;
        shareNode.textContent = `${share}% of ${combinedTotal.toLocaleString()} registered accounts`;
      }
      for (const period of accountGrowthPeriods) {
        const windowMetrics = metrics[period] || {};
        const current = Number(windowMetrics.current || 0);
        const previous = Number(windowMetrics.previous || 0);
        const currentNode = document.querySelector(`[data-account-growth-current="${segment}:${period}"]`);
        const previousNode = document.querySelector(`[data-account-growth-previous="${segment}:${period}"]`);
        const trendNode = document.querySelector(`[data-account-growth-trend="${segment}:${period}"]`);
        if (currentNode) currentNode.textContent = current.toLocaleString();
        if (previousNode) previousNode.textContent = `Prior: ${previous.toLocaleString()}`;
        if (trendNode) {
          const trend = accountGrowthTrend(current, previous);
          trendNode.textContent = trend.text;
          trendNode.className = `admin-badge${trend.tone ? ` ${trend.tone}` : ""}`;
        }
      }
    }

    const combinedMonth = accounts.combined.month || {};
    const monthTrend = accountGrowthTrend(combinedMonth.current, combinedMonth.previous);
    if (monthSummary) {
      monthSummary.textContent = `30-day signups: ${monthTrend.text}`;
      monthSummary.className = `admin-badge${monthTrend.tone ? ` ${monthTrend.tone}` : ""}`;
    }

    if (balance) {
      const customers = Number(accounts.customers.total || 0);
      const businesses = Number(accounts.businesses.total || 0);
      balance.hidden = false;
      balance.textContent = businesses > 0
        ? `Marketplace balance: ${(customers / businesses).toLocaleString(undefined, { maximumFractionDigits: 1 })} customer accounts per business account.`
        : "Marketplace balance: no business accounts yet.";
    }
  }

  function effectiveOfferStatus(offer) {
    if (offer.effective_status) return offer.effective_status;
    const now = Date.now();
    const starts = offer.start_time ? new Date(offer.start_time).getTime() : null;
    const ends = offer.end_time ? new Date(offer.end_time).getTime() : null;
    if (!offer.is_active) return "inactive";
    if (starts && starts > now) return "scheduled";
    if (ends && ends < now) return "expired";
    return "live";
  }

  function renderRecentDeals(offers) {
    const body = document.querySelector("[data-recent-deals-body]");
    const footnote = document.querySelector("[data-recent-deals-footnote]");
    if (!body) return;
    body.textContent = "";
    const rows = (offers || []).slice(0, 3);
    if (footnote) {
      footnote.hidden = rows.length === 0;
      footnote.textContent = rows.length === 0
        ? ""
        : (offers || []).length > rows.length
          ? `Showing the ${rows.length} newest offers. Use All offers for complete history and filters.`
          : `Showing ${rows.length.toLocaleString()} recent offer${rows.length === 1 ? "" : "s"}. Use All offers for complete history and filters.`;
    }
    if (!rows.length) {
      const row = document.createElement("tr");
      const cell = nodeWithText("td", "No recent deals are available.", "admin-row-detail");
      cell.colSpan = 7;
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    for (const offer of rows) {
      const row = document.createElement("tr");
      const status = effectiveOfferStatus(offer);
      const dealCell = document.createElement("div");
      dealCell.appendChild(nodeWithText("strong", offer.title || "Untitled deal"));
      const visibleFlags = Array.isArray(offer.anomaly_flags)
        ? offer.anomaly_flags.filter((flag) => !(status === "inactive" && flag === "no_live_offer"))
        : [];
      if (visibleFlags.length) {
        dealCell.appendChild(nodeWithText("p", visibleFlags.map(humanize).join(" • "), "admin-note"));
      }
      addCell(row, "Offer", dealCell);
      addCell(row, "Business", offer.business_name || "Business");
      addCell(row, "Status", badge(humanize(status), status === "live" ? "success" : status === "scheduled" ? "info" : ""));
      addCell(row, "Claims", Number(offer.claims ?? 0).toLocaleString());
      addCell(row, "Redemptions", Number(offer.redemptions ?? 0).toLocaleString());
      addCell(row, "Ends", formatDate(offer.expires_at ?? offer.end_time, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
      const button = nodeWithText("button", "Open", "button button-small button-secondary");
      button.type = "button";
      button.disabled = !offer.business_id;
      button.addEventListener("click", () => openBusinessPanel(offer.business_id, offer.business_name || offer.title));
      addCell(row, "Action", button);
      body.appendChild(row);
    }
  }

  function onboardingChecklist(row, compact = false) {
    const list = document.createElement("ul");
    list.className = `admin-onboarding-checklist${compact ? " compact" : ""}`;
    for (const step of row.checklist || []) {
      const item = document.createElement("li");
      item.classList.toggle("is-complete", Boolean(step.complete));
      item.append(
        nodeWithText("span", step.complete ? "✓" : "○", "admin-onboarding-check"),
        nodeWithText("span", step.label || humanize(step.key)),
      );
      list.appendChild(item);
    }
    return list;
  }

  function renderOnboarding(rows) {
    const section = document.querySelector("[data-onboarding-section]");
    const list = document.querySelector("[data-onboarding-list]");
    if (!section || !list) return;
    const onboarding = Array.isArray(rows) ? rows : [];
    section.hidden = onboarding.length === 0;
    list.textContent = "";
    for (const item of onboarding.slice(0, 12)) {
      const card = document.createElement("article");
      card.className = "admin-onboarding-card";
      const total = Number(item.total || 9);
      const completed = Number(item.completed_count || 0);
      const progress = Math.max(0, Math.min(100, Math.round((completed / Math.max(total, 1)) * 100)));
      const heading = document.createElement("div");
      heading.className = "admin-onboarding-card-heading";
      heading.append(
        nodeWithText("div", item.business_name || "Business", "admin-onboarding-name"),
        badge(`${completed} of ${total} steps`, completed === total ? "success" : "warning"),
      );
      const track = document.createElement("div");
      track.className = "admin-onboarding-progress";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", `${item.business_name || "Business"} setup progress`);
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", String(total));
      track.setAttribute("aria-valuenow", String(completed));
      const fill = document.createElement("span");
      fill.style.width = `${progress}%`;
      track.appendChild(fill);
      const actions = document.createElement("div");
      actions.className = "admin-inline-actions admin-onboarding-actions";
      const continueButton = nodeWithText("button", "Continue setup", "button button-small");
      continueButton.type = "button";
      continueButton.addEventListener("click", () => openBusinessPanel(item.business_id, item.business_name));
      const repair = nodeWithText("a", "Repair account", "button button-small button-secondary");
      repair.href = `/admin/accounts?q=${encodeURIComponent(item.owner_email || item.business_name || "")}`;
      const billing = nodeWithText("a", "Billing setup", "button button-small button-secondary");
      billing.href = `/admin/trial-requests?businessId=${encodeURIComponent(item.business_id || "")}`;
      const nextIncomplete = (item.checklist || []).find((step) => !step.complete);
      const nextStep = document.createElement("div");
      nextStep.className = "admin-onboarding-next";
      nextStep.append(
        nodeWithText("span", "Next step"),
        nodeWithText("strong", nextIncomplete?.label || "Setup checklist complete"),
      );
      const checklistDetails = document.createElement("details");
      checklistDetails.className = "admin-onboarding-details";
      checklistDetails.append(
        nodeWithText("summary", `View all ${total} setup steps`),
        onboardingChecklist(item, true),
      );
      actions.append(continueButton, contactOwnerButton(item.business_id, "setup_help"));
      const moreActions = document.createElement("details");
      moreActions.className = "admin-more-actions";
      const moreActionList = document.createElement("div");
      moreActionList.className = "admin-inline-actions";
      moreActionList.append(repair, billing, ownerViewButton(item.business_id));
      moreActions.append(nodeWithText("summary", "More actions"), moreActionList);
      actions.appendChild(moreActions);
      const progressSummary = document.createElement("div");
      progressSummary.className = "admin-onboarding-summary";
      progressSummary.append(
        nodeWithText("p", item.owner_email || "Owner email unavailable", "admin-note"),
        track,
        nextStep,
        checklistDetails,
      );
      card.append(
        heading,
        progressSummary,
        actions,
      );
      list.appendChild(card);
    }
  }

  function metricBlock(label, value) {
    const block = document.createElement("div");
    block.className = "admin-panel-metric";
    block.append(nodeWithText("span", label), nodeWithText("strong", String(value ?? "—")));
    return block;
  }

  function closeBusinessPanel() {
    const panel = document.querySelector("[data-business-side-panel]");
    const backdrop = document.querySelector("[data-side-panel-backdrop]");
    if (!panel || !backdrop) return;
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
  }

  async function openBusinessPanel(businessId, fallbackName = "Business") {
    if (!businessId) return;
    const panel = document.querySelector("[data-business-side-panel]");
    const backdrop = document.querySelector("[data-side-panel-backdrop]");
    const title = document.querySelector("[data-business-panel-title]");
    const meta = document.querySelector("[data-business-panel-meta]");
    const content = document.querySelector("[data-business-panel-content]");
    if (!panel || !backdrop || !title || !meta || !content) return;
    title.textContent = fallbackName || "Business detail";
    meta.textContent = "Loading current activity…";
    content.replaceChildren(nodeWithText("p", "Loading business detail…", "status"));
    backdrop.hidden = false;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    document.querySelector("[data-close-side-panel]")?.focus();
    try {
      const payload = await Shell.adminPost("admin-dashboard-summary", {
        section: "business_detail",
        business_id: businessId,
      });
      const business = payload.business || {};
      const activity = payload.offer_activity || {};
      const claims = payload.claims_and_redemptions || {};
      const trial = payload.trial_and_access || {};
      const ai = payload.ai_usage || {};
      title.textContent = business.name || fallbackName || "Business detail";
      meta.textContent = [humanize(business.status), business.owner_email].filter(Boolean).join(" • ");
      content.textContent = "";
      const metrics = document.createElement("div");
      metrics.className = "admin-panel-metrics";
      metrics.append(
        metricBlock("Live offers", activity.live_offer_count || 0),
        metricBlock("Claims · 30d", claims.claims_30d || 0),
        metricBlock("Redemptions · 30d", claims.redemptions_30d || 0),
        metricBlock("Trial days left", trial.trial_days_remaining ?? "—"),
        metricBlock("AI quota risk", humanize(ai.ai_quota_risk || "normal")),
        metricBlock("AI spend", ai.ai_cost_available === false ? "Unavailable" : formatUsd(ai.ai_month_cost_usd || 0)),
      );
      content.appendChild(metrics);
      if (payload.health?.primary_reason) {
        const health = document.createElement("article");
        health.className = "admin-panel";
        health.append(
          nodeWithText("h3", payload.health.primary_reason),
          nodeWithText("p", payload.health.suggested_read_only_action || "Review current activity."),
        );
        content.appendChild(health);
      }
      if (payload.onboarding) {
        const setup = document.createElement("section");
        setup.className = "admin-panel";
        setup.append(
          nodeWithText("h3", `Setup progress · ${payload.onboarding.completed_count || 0} of ${payload.onboarding.total || 9}`),
          onboardingChecklist(payload.onboarding),
        );
        content.appendChild(setup);
      }
      const offers = activity.offers || [];
      const heading = nodeWithText("h3", "Live and scheduled offers");
      heading.style.marginTop = "22px";
      content.appendChild(heading);
      const wrap = document.createElement("div");
      wrap.className = "admin-table-wrap";
      const table = document.createElement("table");
      table.className = "admin-table";
      table.dataset.mobileCards = "";
      table.innerHTML = "<thead><tr><th>Offer</th><th>Status</th><th>Claims</th><th>Redemptions</th></tr></thead>";
      const tbody = document.createElement("tbody");
      if (!offers.length) {
        const row = document.createElement("tr");
        const cell = nodeWithText("td", "No live or scheduled offers.", "admin-row-detail");
        cell.colSpan = 4;
        row.appendChild(cell);
        tbody.appendChild(row);
      } else {
        for (const offer of offers) {
          const row = document.createElement("tr");
          addCell(row, "Offer", offer.title || "Untitled offer");
          addCell(row, "Status", humanize(offer.status));
          addCell(row, "Claims", offer.claim_count || 0);
          addCell(row, "Redemptions", offer.redemption_count || 0);
          tbody.appendChild(row);
        }
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      content.appendChild(wrap);
      const actions = document.createElement("div");
      actions.className = "admin-inline-actions";
      const detailLink = nodeWithText("a", "Open full business detail", "button button-small");
      detailLink.href = `/admin/businesses/detail?businessId=${encodeURIComponent(businessId)}`;
      const offersLink = nodeWithText("a", "Review all offers", "button button-small button-secondary");
      offersLink.href = `/admin/offers?businessId=${encodeURIComponent(businessId)}`;
      actions.append(detailLink, offersLink, ownerViewButton(businessId));
      content.appendChild(actions);
    } catch (error) {
      meta.textContent = "";
      content.replaceChildren(nodeWithText("p", error.message || "Could not load business detail.", "status error"));
    }
  }

  function wireDashboard() {
    const dateNode = document.querySelector("[data-ops-date]");
    if (dateNode) {
      dateNode.textContent = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date());
    }
    document.querySelector("[data-ops-search-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = String(new FormData(event.currentTarget).get("q") || "").trim();
      window.location.assign(query ? `/admin/accounts?q=${encodeURIComponent(query)}` : "/admin/accounts");
    });
    document.querySelector("[data-queue-filters]")?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-queue-filter]");
      if (!button) return;
      activeQueueFilter = button.dataset.queueFilter;
      document.querySelectorAll("[data-queue-filter]").forEach((node) => {
        const active = node === button;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-pressed", String(active));
      });
      renderQueue();
    });
    document.querySelector("[data-queue-status-filter]")?.addEventListener("change", (event) => {
      activeQueueStatusFilter = event.currentTarget.value;
      renderQueue();
    });
    document.querySelector("[data-close-side-panel]")?.addEventListener("click", closeBusinessPanel);
    document.querySelector("[data-side-panel-backdrop]")?.addEventListener("click", closeBusinessPanel);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeBusinessPanel();
    });
  }

  async function loadDashboard() {
    setStatus("Loading operations overview");
    const [summaryResult, offersResult] = await Promise.allSettled([
      Shell.adminPost("admin-dashboard-summary", {}),
      Shell.adminPost("admin-dashboard-summary", { section: "offers" }),
    ]);
    if (summaryResult.status === "rejected") {
      setStatus(summaryResult.reason?.message || "Could not load admin summary", "danger");
      queueItems = [];
      renderQueue();
      renderRecentDeals(offersResult.status === "fulfilled" ? offersResult.value.offers : []);
      return;
    }
    const payload = summaryResult.value;
    const summary = payload.summary || {};
    const healthRows = payload.businessHealth || [];
    queueStatusEnabled = Array.isArray(payload.queueAll);
    setStatus(`Signed in as ${payload.admin?.role || "admin"}`, "success");
    renderMetrics(summary);
    renderAccountGrowth(summary.accounts, payload.summaryV2Errors?.accountGrowth);
    renderServiceAlerts(healthRows);
    renderOnboarding(payload.onboarding);
    businessHealthTotal = Number(payload.businessHealthTotal ?? healthRows.length);
    queueItems = Array.isArray(payload.queueAll)
      ? payload.queueAll.map((item) => ({
        ...item,
        priority: Number(item.attention_score || 0),
        status: item.status || "new",
        href: item.links?.primary || item.links?.business || "/admin",
        persistent: true,
      }))
      : buildQueue(summary, healthRows);
    renderQueue();
    renderRecentDeals(
      Array.isArray(payload.recentDeals)
        ? payload.recentDeals
        : offersResult.status === "fulfilled"
          ? offersResult.value.offers
          : [],
    );
    const updated = document.querySelector("[data-dashboard-updated]");
    if (updated) {
      updated.textContent = `Updated ${new Date().toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    }
  }

  async function boot() {
    Shell.syncSessionActions();
    if (!Shell.hasStoredToken()) return;
    const root = document.querySelector("[data-admin-app-root]");
    if (!root) return;
    try {
      const response = await fetch("/admin/app.html", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      root.innerHTML = await response.text();
    } catch {
      setStatus("Could not load admin operations console", "danger");
      return;
    }
    Shell.hydrate(root);
    wireDashboard();
    loadDashboard();
  }

  boot();
})();
