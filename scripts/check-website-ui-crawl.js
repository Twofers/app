const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = process.cwd();
const SITE_ROOT = path.join(ROOT, "website");
const SUPABASE_FUNCTIONS_HOST = "https://kvodhiqhdqnptqovovia.supabase.co/**";
const SCREENSHOT_DIR = process.env.WEBSITE_UI_SCREENSHOT_DIR
  ? path.resolve(process.env.WEBSITE_UI_SCREENSHOT_DIR)
  : "";
const SCREENSHOT_ROUTES = new Set(["/", "/business/start-trial/", "/admin/", "/admin/trial-requests/", "/admin/prospects/", "/admin/qr-campaigns/"]);

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
]);

const DEFAULT_ROUTES = [
  "/",
  "/404.html",
  "/business/",
  "/business/start-trial/",
  "/business/thanks/",
  "/business/claim/mock-claim-token",
  "/business/waitlist/",
  "/business/review-pending/",
  "/quick-approve-trial/#token=mock_quick_approval_token_12345678901234567890",
  "/business-terms/",
  "/business/billing/start/",
  "/business/billing/status/",
  "/business/billing/manage/",
  "/business/billing/success/",
  "/business/billing/cancel/",
  "/business/billing/add-payment-method/",
  "/support/",
  "/delete-account/",
  "/terms/",
  "/privacy/",
  "/s/smoke-deal",
  "/admin/login/",
  "/admin/",
  "/admin/accounts/",
  "/admin/account-repair/",
  "/admin/communications/",
  "/admin/ai-usage/",
  "/admin/prospects/",
  "/admin/prospects/import/",
  "/admin/prospects/11111111-1111-4111-8111-111111111111/",
  "/admin/trial-requests/",
  "/admin/businesses/",
  "/admin/businesses/new/",
  "/admin/businesses/detail/",
  "/admin/qr-campaigns/",
  "/admin/offers/",
  "/admin/offers/?view=redemptions",
  "/admin/billing/events/",
  "/admin/audit-log/",
  "/admin/settings/",
  "/admin/ai-operating-report/",
  "/admin/ai-prompts/",
];
const ROUTES = process.env.WEBSITE_UI_ROUTES
  ? process.env.WEBSITE_UI_ROUTES.split(",").map((route) => route.trim()).filter(Boolean)
  : DEFAULT_ROUTES;

const VIEWPORTS = [
  { name: "desktop", width: 1366, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

function routeToFile(pathname) {
  if (pathname === "/") return path.join(SITE_ROOT, "index.html");
  if (pathname.startsWith("/s/") && !path.extname(pathname)) return path.join(SITE_ROOT, "s", "index.html");
  if (path.extname(pathname)) return path.join(SITE_ROOT, pathname);
  if (/^\/business\/claim\/[^/]+\/?$/i.test(pathname)) {
    return path.join(SITE_ROOT, "business", "claim", "index.html");
  }
  if (/^\/admin\/prospects\/[0-9a-f-]+(?:\/(?:demand|sales|claim-links))?\/?$/i.test(pathname)) {
    return path.join(SITE_ROOT, "admin", "prospects", "detail", "index.html");
  }
  if (/^\/admin\/businesses\/[0-9a-f-]{36}\/?$/i.test(pathname)) {
    return path.join(SITE_ROOT, "admin", "businesses", "detail", "index.html");
  }
  return path.join(SITE_ROOT, pathname, "index.html");
}

function safePathname(url) {
  return decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
}

function withinSite(filePath) {
  const resolved = path.resolve(filePath);
  return resolved === SITE_ROOT || resolved.startsWith(`${SITE_ROOT}${path.sep}`);
}

function createServer() {
  return http.createServer((req, res) => {
    try {
      const filePath = routeToFile(safePathname(req.url));
      if (!withinSite(filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const notFoundPath = path.join(SITE_ROOT, "404.html");
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(notFoundPath).pipe(res);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME.get(ext) || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(error?.stack || error));
    }
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function safeName(value) {
  return value
    .replace(/^\//, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/(^-|-$)/g, "") || "root";
}

function mockPayload(pathname, requestBody) {
  if (pathname.endsWith("/admin-dashboard-summary")) {
    if (requestBody?.section === "queue_status") {
      return {
        ok: true,
        queue_status: {
          issue_key: requestBody.issue_key,
          status: requestBody.status,
          note: requestBody.note || null,
          updated_at: "2026-07-02T12:40:00.000Z",
        },
      };
    }
    if (requestBody?.section === "businesses") {
      return {
        ok: true,
        admin: { role: "owner" },
        businesses: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "Sample Coffee",
            owner_email: "owner@example.com",
            status: "trialing",
            access_level: "full_trial",
            verification_status: "manual_verified",
            risk_level: "low",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      };
    }

    if (requestBody?.section === "prospects") {
      return {
        ok: true,
        admin: { role: "owner" },
        prospects: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            display_name: "Sample Cafe Prospect",
            city: "Irving",
            state: "TX",
            category: "Cafe",
            public_label_state: "not_on_twofer_yet",
            demand_count: 14,
            status: "ready_to_contact",
            review_status: "approved",
            score: { total_score: 84, tier: "A", recommended_next_action: "Prepare demand proof and send a claim link" },
            sales_account: { stage: "ready_to_contact", next_action: "Visit owner", last_contact_at: null },
            linked_business: null,
          },
        ],
      };
    }

    if (requestBody?.section === "prospect_detail") {
      return {
        ok: true,
        admin: { role: "owner" },
        prospect: {
          id: requestBody.prospect_id || "11111111-1111-4111-8111-111111111111",
          display_name: "Sample Cafe Prospect",
          city: "Irving",
          state: "TX",
          postal_code: "75039",
          category: "Cafe",
          public_label_state: "not_on_twofer_yet",
          status: "ready_to_contact",
          review_status: "approved",
          private_contact_json: {},
        },
        linked_business: null,
        billing: null,
        sources: [{ provider: "manual", source_payload_hash: "abc123", confidence: 0.8, fetched_at: "2026-07-02T12:00:00.000Z" }],
        enrichments: [{ provider: "twofer_rules", model: "deterministic-v1", review_status: "needs_review", confidence: 0.65, created_at: "2026-07-02T12:05:00.000Z" }],
        scores: [{ total_score: 84, tier: "A", score_version: "prospect-score-v1", recommended_next_action: "Prepare demand proof and send a claim link", created_at: "2026-07-02T12:10:00.000Z" }],
        demand_rollups: [{ rollup_date: "2026-07-02", requests_count: 8, favorites_count: 4, views_count: 2, unique_users_count: 7 }],
        sales_account: { stage: "ready_to_contact", priority: "high", next_action: "Visit owner", notes: "" },
        sales_activities: [{ activity_type: "note", summary: "Seeded prospect", outcome: "", created_at: "2026-07-02T12:12:00.000Z" }],
        claim_links: [{ created_at: "2026-07-02T12:15:00.000Z", expires_at: "2026-07-16T12:15:00.000Z", uses_count: 0, max_uses: 1 }],
        conversions: [],
        audit_log: [{ admin_email: "admin@example.com", action: "admin_prospect_imported", reason: "qa", created_at: "2026-07-02T12:00:00.000Z" }],
      };
    }

    if (requestBody?.section === "owner_view") {
      return {
        ok: true,
        admin: { role: "owner" },
        section: "owner_view",
        owner_view: {
          business: {
            id: requestBody.business_id,
            name: "Sample Coffee",
            category: "Cafe",
            verification_status: "manual_verified",
          },
          offers: [{
            id: "deal-1",
            title: "Morning pastry offer",
            status: "live",
            claim_count: 4,
            redemption_count: 1,
          }],
          claims: { total: 4, redemptions: 1 },
          subscription: { app_access_status: "trialing", billing_status: "trialing" },
          banners: [{ tone: "info", message: "Trial access ends August 1." }],
          read_only: true,
          impersonation: false,
        },
      };
    }

    if (requestBody?.section === "business_detail") {
      return {
        ok: true,
        admin: { role: "owner" },
        business: {
          id: requestBody.business_id || "11111111-1111-4111-8111-111111111111",
          name: "Sample Coffee",
          owner_email: "owner@example.com",
          status: "approved_not_activated",
          access_level: "approved_not_activated",
          verification_status: "manual_verified",
          risk_level: "low",
        },
        applications: [
          {
            contact_name: "Pat Owner",
            email: "pat@example.com",
            status: "approved_not_activated",
            access_tier: "approved_not_activated",
            trial_days: null,
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
        audit_log: [
          {
            admin_email: "admin@example.com",
            action: "admin_business_application_approved_for_setup_full",
            reason: "qa",
            created_at: "2026-07-02T12:01:00.000Z",
          },
        ],
        health: {
          health_label: "watch",
          attention_score: 25,
          primary_reason: "No recent offers are available",
          reason_codes: ["no_recent_offers"],
          suggested_read_only_action: "Review offer performance and merchant setup",
        },
        offer_activity: {
          live_offer_count: 1,
          active_or_scheduled_offer_count: 2,
          last_offer_at: "2026-06-20T12:00:00.000Z",
          days_since_last_offer: 15,
          offers: [
            {
              id: "deal-1",
              title: "Morning pastry offer",
              start_time: "2026-07-02T13:00:00.000Z",
              end_time: "2026-07-09T13:00:00.000Z",
              status: "live",
              claim_count: 4,
              redemption_count: 1,
            },
          ],
        },
        claims_and_redemptions: {
          claims_7d: 1,
          claims_30d: 4,
          unredeemed_claims_30d: 3,
          redemptions_7d: 0,
          redemptions_30d: 1,
          last_redeemed_at: "2026-06-15T12:00:00.000Z",
        },
        trial_and_access: {
          trial_request_status: "trial_active",
          trial_request_created_at: "2026-06-01T12:00:00.000Z",
          app_access_status: "trialing",
          trial_ends_at: "2026-07-15T12:00:00.000Z",
          trial_days_remaining: 10,
        },
        ai_usage: {
          ai_month_used_max: 4,
          ai_month_limit_for_max: 25,
          ai_quota_risk: "normal",
          ai_month_cost_usd: 0.42,
          ai_cost_available: true,
        },
        onboarding: {
          business_id: requestBody.business_id || "11111111-1111-4111-8111-111111111111",
          business_name: "Sample Coffee",
          owner_email: "owner@example.com",
          completed_count: 5,
          total: 9,
          checklist: [
            { key: "application_approved", label: "Application approved", complete: true },
            { key: "owner_email_verified", label: "Owner email verified", complete: true },
            { key: "business_info_complete", label: "Business information complete", complete: true },
            { key: "terms_accepted", label: "Business terms accepted", complete: true },
            { key: "trial_activated", label: "Trial or access activated", complete: true },
            { key: "billing_confirmed", label: "Billing confirmed", complete: false },
            { key: "first_offer_created", label: "First offer created", complete: false },
            { key: "first_offer_published", label: "First offer published", complete: false },
            { key: "redemption_tested", label: "Redemption tested", complete: false },
          ],
        },
        business_health_error: null,
      };
    }

    if (requestBody?.section === "redemptions") {
      return {
        ok: true,
        admin: { role: "owner" },
        redemptions: [{
          claim_id: "claim-1",
          business_id: "11111111-1111-4111-8111-111111111111",
          deal_id: "deal-1",
          deal_title: "Morning pastry offer",
          business_name: "Sample Coffee",
          redeemed_at: "2026-07-02T12:30:00.000Z",
          redeem_method: "staff_qr",
          claimed_at: "2026-07-02T12:00:00.000Z",
        }],
      };
    }

    if (requestBody?.section === "offers") {
      return {
        ok: true,
        admin: { role: "owner" },
        offers: [
          {
            id: "offer-1",
            business_id: "11111111-1111-4111-8111-111111111111",
            title: "Morning pastry offer",
            business_name: "Sample Bakery",
            is_active: true,
            effective_status: "live",
            start_time: "2026-07-02T13:00:00.000Z",
            end_time: "2026-07-02T15:00:00.000Z",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      };
    }

    if (requestBody?.section === "billing_events") {
      return {
        ok: true,
        admin: { role: "owner" },
        billing_events: [
          {
            event_type: "customer.created",
            provider: "stripe",
            processing_status: "processed",
            received_at: "2026-07-02T12:00:00.000Z",
            processed_at: "2026-07-02T12:00:05.000Z",
            error_message: "",
          },
        ],
      };
    }

    if (requestBody?.section === "audit_log") {
      return {
        ok: true,
        admin: { role: "owner" },
        audit_log: [
          {
            admin_email: "admin@example.com",
            action: "admin_login_success",
            target_type: "admin_login",
            business_id: "",
            reason: "",
            created_at: "2026-07-02T12:00:00.000Z",
          },
        ],
      };
    }

    if (requestBody?.section === "settings") {
      return {
        ok: true,
        admin: { role: "owner" },
        launch_areas: [{ name: "DFW", city: "Dallas", state: "TX", status: "active", timezone: "America/Chicago" }],
        feature_flags: [{ key: "share_deal", description: "Share Deal", enabled: true, updated_at: "2026-07-02T12:00:00.000Z" }],
        admin_users: [{ email: "admin@example.com", role: "owner", is_active: true, require_mfa: true, last_admin_login_at: "2026-07-02T12:00:00.000Z" }],
      };
    }

    return {
      ok: true,
      admin: { role: "owner" },
      summary: {
        businesses: { active: 4, pendingVerification: 2, trialingLocations: 1, trialsEndingSoon: 1, withLiveOffer: 3 },
        trialRequests: { open: 3, highRisk: 1 },
        offers: { live: 7, needsReview: 2 },
        deals: { createdToday: 2, created7d: 9, liveNow: 7 },
        redemptions: { today: 1, last7d: 8, claimToRedeemRate30d: 0.42 },
        users: {
          active30d: 24,
          definition: "Distinct consumer with an app_opened, deal_viewed, deal_claimed, or deal_redeemed event in app_analytics_events in the last 30 days, excluding business-role users.",
        },
        accounts: {
          as_of: "2026-07-02T12:00:00.000Z",
          definition: "Mock account-growth definition.",
          customers: {
            total: 240,
            day: { current: 8, previous: 5 },
            week: { current: 34, previous: 28 },
            month: { current: 110, previous: 92 },
          },
          businesses: {
            total: 24,
            day: { current: 1, previous: 2 },
            week: { current: 5, previous: 3 },
            month: { current: 12, previous: 8 },
          },
          combined: {
            total: 264,
            day: { current: 9, previous: 7 },
            week: { current: 39, previous: 31 },
            month: { current: 122, previous: 100 },
          },
        },
        apiSpend: { currentMonthUsd: 1.25, priorMonthUsd: 7.32, perGeneratedDealUsd: 0.14, updatedAt: "2026-07-02T12:30:00.000Z" },
        activity: { claimsToday: 2, redemptionsToday: 1, newConsumersThisWeek: 6 },
        billing: { pastDueLocations: 0, pastDueBusinesses: 0, missingStripeCustomers: 1, stripeWebhookErrors: 1 },
        security: { failedAdminActions: 0 },
        moderation: { openReports: 1 },
      },
      businessHealth: [
        {
          business_id: "11111111-1111-4111-8111-111111111111",
          business_name: "Sample Coffee",
          health_label: "needs_attention",
          attention_score: 65,
          primary_reason: "Claims are not turning into redemptions",
          reason_codes: ["claims_no_redemptions"],
          suggested_read_only_action: "Review offer performance and merchant setup",
          claims_30d: 4,
          redemptions_30d: 0,
          last_offer_at: "2026-07-02T12:00:00.000Z",
        },
      ],
      businessHealthError: null,
      businessHealthTotal: 1,
      onboarding: [
        {
          business_id: "11111111-1111-4111-8111-111111111111",
          business_name: "Sample Coffee",
          owner_email: "owner@example.com",
          completed_count: 5,
          total: 9,
          checklist: [
            { key: "application_approved", label: "Application approved", complete: true },
            { key: "owner_email_verified", label: "Owner email verified", complete: true },
            { key: "business_info_complete", label: "Business information complete", complete: true },
            { key: "terms_accepted", label: "Business terms accepted", complete: true },
            { key: "trial_activated", label: "Trial or access activated", complete: true },
            { key: "billing_confirmed", label: "Billing confirmed", complete: false },
            { key: "first_offer_created", label: "First offer created", complete: false },
            { key: "first_offer_published", label: "First offer published", complete: false },
            { key: "redemption_tested", label: "Redemption tested", complete: false },
          ],
        },
      ],
      queue: [
        {
          key: "claims_no_redemptions:11111111-1111-4111-8111-111111111111",
          category: "redemptions",
          priority: "medium",
          attention_score: 65,
          business_id: "11111111-1111-4111-8111-111111111111",
          business_name: "Sample Coffee",
          title: "Claims are not turning into redemptions",
          explanation: "Customers are claiming offers but none have been redeemed.",
          waiting_since: "2026-07-02T12:00:00.000Z",
          recommended_action: "Review the redemption setup",
          links: { business: "/admin/businesses/detail?businessId=11111111-1111-4111-8111-111111111111" },
        },
      ],
      queueAll: [
        {
          key: "claims_no_redemptions:11111111-1111-4111-8111-111111111111",
          category: "redemptions",
          priority: "medium",
          attention_score: 65,
          business_id: "11111111-1111-4111-8111-111111111111",
          business_name: "Sample Coffee",
          title: "Claims are not turning into redemptions",
          explanation: "Customers are claiming offers but none have been redeemed.",
          waiting_since: "2026-07-02T12:00:00.000Z",
          recommended_action: "Review the redemption setup",
          status: "new",
          note: null,
          links: { business: "/admin/businesses/detail?businessId=11111111-1111-4111-8111-111111111111" },
        },
      ],
      recentDeals: [
        {
          id: "offer-1",
          business_id: "11111111-1111-4111-8111-111111111111",
          business_name: "Sample Bakery",
          title: "Morning pastry offer",
          status: "live",
          claims: 4,
          redemptions: 1,
          expires_at: "2026-07-02T15:00:00.000Z",
          created_at: "2026-07-02T12:00:00.000Z",
          anomaly_flags: [],
        },
      ],
      summaryV2Errors: { activeUsers: null, accountGrowth: null, businessesWithLiveOffer: null, recentDeals: null },
      recentApplications: [
        {
          business_name: "Sample Coffee",
          email: "owner@example.com",
          status: "pending_review",
          access_tier: "review_required",
          created_at: "2026-07-02T12:00:00.000Z",
        },
      ],
      recentAudit: [
        {
          action: "admin_login_success",
          target_type: "admin_login",
          reason: "",
          created_at: "2026-07-02T12:01:00.000Z",
        },
      ],
    };
  }

  if (pathname.endsWith("/admin-ai-usage")) {
    const reset = requestBody?.action === "reset_quota";
    const business = {
      id: "business-1",
      name: "Sample Coffee",
      status: "trialing",
      usage: [
        {
          scope: "ad_generation",
          used: reset ? 0 : 4,
          limit: 25,
          remaining: reset ? 25 : 21,
          countSince: "2026-07-01T00:00:00.000Z",
          resetAt: reset ? "2026-07-02T12:40:00.000Z" : null,
        },
      ],
    };
    return { ok: true, user: { id: "user-1", email: "owner@example.com" }, businesses: [business], business };
  }

  if (pathname.endsWith("/admin-qr-campaigns")) {
    const campaign = {
      id: "33333333-3333-4333-8333-333333333333",
      campaign_id: "33333333-3333-4333-8333-333333333333",
      business_id: "11111111-1111-4111-8111-111111111111",
      business_name: "Sample Coffee",
      slug: "q-samplecoffe",
      display_name: "Counter sign",
      source_type: "counter_sign",
      destination_type: "app_download",
      is_active: true,
      created_at: "2026-07-02T12:00:00.000Z",
      scan_count: 12,
      likely_human_scan_count: 10,
      likely_bot_scan_count: 2,
      tracking_url: "https://www.twoferapp.com/r/q-samplecoffe",
    };
    if (requestBody?.action === "qr") {
      return {
        ok: true,
        campaign,
        qr_svg_data_url: "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22512%22%20height%3D%22512%22%3E%3Crect%20width%3D%22512%22%20height%3D%22512%22%20fill%3D%22white%22%2F%3E%3C%2Fsvg%3E",
      };
    }
    if (requestBody?.action === "create" || requestBody?.action === "disable") return { ok: true, campaign };
    return {
      ok: true,
      businesses: [{ id: campaign.business_id, name: campaign.business_name, status: "trialing" }],
      analytics: {
        days: 30,
        campaigns: [campaign],
        businesses: [{ business_id: campaign.business_id, business_name: campaign.business_name, scan_count: 12, likely_human_scan_count: 10, likely_bot_scan_count: 2 }],
        sources: [{ source_type: "counter_sign", scan_count: 12, likely_human_scan_count: 10, likely_bot_scan_count: 2 }],
        daily: [{ scan_date: "2026-07-02", scan_count: 12, likely_human_scan_count: 10, likely_bot_scan_count: 2 }],
      },
    };
  }

  if (pathname.endsWith("/admin-business-applications")) {
    if (requestBody?.action === "quick_preview") {
      return {
        ok: true,
        application: {
          business_name: "Sample Bakery",
          contact_name: "Pat Owner",
          email: "pat@example.com",
          address: "123 Main St, Dallas, TX",
          business_type: "bakery",
          risk_score: 75,
        },
        approval: { trial_days: 30, offer_limit: 3, claim_limit: 50 },
      };
    }
    if (requestBody?.action === "quick_confirm") {
      return { ok: true, business_name: "Sample Bakery", approval_email_warning: null };
    }
    return {
      ok: true,
      business_linked: false,
      applications: [
        {
          id: "app-1",
          business_name: "Sample Bakery",
          contact_name: "Pat Owner",
          email: "pat@example.com",
          launch_area: "Dallas",
          risk_score: 12,
          status: "pending_review",
          business_type: "bakery",
          address: "123 Main",
          slow_hours: "2-4 PM",
          offer_interests: "Limited-time pastry offer",
          risk_reasons: ["new domain"],
        },
      ],
    };
  }

  if (pathname.endsWith("/admin-prospect-import")) {
    return {
      ok: true,
      prospects: [{ id: "11111111-1111-4111-8111-111111111111", display_name: "Sample Cafe Prospect" }],
    };
  }

  if (pathname.endsWith("/admin-prospect-enrich")) return { ok: true, enrichment: { id: "enrich-1" } };
  if (pathname.endsWith("/admin-prospect-score")) return { ok: true, score: { total_score: 84, tier: "A" } };
  if (pathname.endsWith("/admin-demand-proof")) {
    return { ok: true, report: { merchant_safe_lines: ["14 locals have requested updates from Sample Cafe Prospect."] } };
  }
  if (pathname.endsWith("/admin-sales-script")) return { ok: true, script: "Call script ready." };
  if (pathname.endsWith("/admin-prospect-sales")) return { ok: true, account: { stage: "contacted" } };
  if (pathname.endsWith("/admin-claim-link-create")) {
    return { ok: true, claim_url: "https://www.twoferapp.com/business/claim/mock-claim-token", claim_link: { id: "claim-1" } };
  }
  if (pathname.endsWith("/admin-trial-create-from-prospect")) {
    return { ok: true, application: { id: "app-1" }, business_onboarding_request_id: "request-1" };
  }
  if (pathname.endsWith("/admin-account-management")) {
    if (requestBody?.action === "list") {
      return {
        ok: true,
        accounts: [{
          user_id: "22222222-2222-4222-8222-222222222222",
          email: "owner@example.com",
          role: "business",
          account_status: "active",
          business_name: "Sample Coffee",
          business_id: "11111111-1111-4111-8111-111111111111",
          last_sign_in_at: "2026-07-02T12:00:00.000Z",
          auth_created_at: "2026-06-01T12:00:00.000Z",
        }],
        total: 1,
        page: 1,
        per_page: 50,
      };
    }
    if (requestBody?.action === "detail") {
      return {
        ok: true,
        account: {
          user_id: requestBody.user_id,
          email: "owner@example.com",
          role: "business",
          account_status: "active",
          email_confirmed_at: "2026-06-01T12:00:00.000Z",
          last_sign_in_at: "2026-07-02T12:00:00.000Z",
          mfa_factors: [{ factor_type: "totp", status: "verified" }],
        },
        businesses: [{ id: "11111111-1111-4111-8111-111111111111", name: "Sample Coffee" }],
        subscriptions: [{ app_access_status: "trialing", billing_status: "trialing", trial_end: "2026-08-01T12:00:00.000Z" }],
        impact: { recent_redemption_failures: 0, redemption_lockout_active: false },
        audit_log: [{ action: "admin_account_viewed", admin_email: "admin@example.com", reason: "support", created_at: "2026-07-02T12:00:00.000Z" }],
        permissions: { can_repair: true, can_manage_lifecycle: true },
      };
    }
    return { ok: true, action: requestBody?.action, repair: { delivered: true } };
  }
  if (pathname.endsWith("/admin-owner-email")) {
    if (requestBody?.action === "list") {
      return {
        ok: true,
        communications: [{
          id: "communication-1",
          business_id: "11111111-1111-4111-8111-111111111111",
          reason_category: "setup_help",
          subject: "A quick next step for Sample Coffee",
          status: "sent",
          sent_at: "2026-07-02T12:00:00.000Z",
          created_at: "2026-07-02T12:00:00.000Z",
          businesses: { name: "Sample Coffee" },
        }],
      };
    }
    if (requestBody?.action === "draft" || requestBody?.action === "refine") {
      return {
        ok: true,
        business: { business_id: requestBody.business_id, business_name: "Sample Coffee" },
        draft: {
          subject: "A quick next step for Sample Coffee",
          body: "Hi Pat,\\n\\nWe noticed there is still a setup step to finish. Reply and we will help.",
          fallback_used: false,
          requires_human_review: true,
        },
      };
    }
    return { ok: true, communication: { id: "communication-1", status: requestBody?.action === "send" ? "sent" : "draft" } };
  }
  if (pathname.endsWith("/admin-ai-operating-report")) {
    return {
      ok: true,
      admin: { role: "owner" },
      report: {
        ai: { enrichment_volume: 3, cost_by_feature_model: [{ feature: "prospect_enrichment", model: "deterministic-v1", endpoint: "admin", total_ai_cost_usd: 0, call_count: 3, failed_or_retried_calls: 0 }], circuit_breakers: [] },
        prospects: { needing_review: 2, stale_source_count: 1, score_distribution: { A: 1, B: 2, C: 0, D: 0 } },
        demand_and_sales: { demand_proof_generated: 2, sales_activity_count: 4 },
        claim_links: { sent: 3, accepted: 1, expired: 0 },
        conversions: { prospect_to_trial: 1, trial_to_active: 0 },
        recent_admin_activity: [{ action: "admin_prospect_imported", target_type: "business_prospect", reason: "qa", created_at: "2026-07-02T12:00:00.000Z" }],
      },
    };
  }

  if (pathname.endsWith("/admin-ai-prompts")) {
    return {
      ok: true,
      defaults: { operating_report: "admin-operating-report-v1" },
      prompts: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          prompt_name: "operating_report",
          feature: "operating_report",
          prompt_version: "admin-operating-report-v1",
          system_prompt: "You help run Twofer operations from the internal website/admin dashboard only. Return only strict JSON matching the schema.",
          output_schema: {},
          is_active: true,
          last_used_at: "2026-08-02T12:00:00.000Z",
        },
      ],
    };
  }

  if (pathname.endsWith("/business-claim-link")) {
    return {
      ok: true,
      preview: {
        business_name: "Sample Cafe Prospect",
        city: "Irving",
        state: "TX",
        category: "Cafe",
        public_label_state: "Not on Twofer yet",
        statement: "This profile is not active on Twofer until you claim and complete setup.",
      },
      next_step: "Check your email and sign in with this business email to finish setup before the profile can become active.",
    };
  }

  if (pathname.endsWith("/admin-auth-session")) {
    return { ok: true, session: { access_token: "mock-token", refresh_token: "mock-refresh", expires_in: 3600 } };
  }

  if (pathname.endsWith("/submit-business-application")) {
    return { ok: true, application_id: "app-1" };
  }

  return { ok: true };
}

async function installMocks(page) {
  await page.route("**/api/admin/session", async (route) => {
    const method = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(method === "GET"
        ? { ok: true, authenticated: true, pending_mfa: false }
        : { ok: true, authenticated: true }),
    });
  });
  await page.route("**/api/admin/proxy?function=*", async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || "{}");
    } catch {
      body = {};
    }
    const url = new URL(route.request().url());
    const functionName = url.searchParams.get("function") || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPayload(`/${functionName}`, body)),
    });
  });
  await page.route(SUPABASE_FUNCTIONS_HOST, async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || "{}");
    } catch {
      body = {};
    }
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockPayload(url.pathname, body)),
    });
  });
}

async function prepareStorage(context, route) {
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

function isPublicRoute(route) {
  return !route.startsWith("/admin");
}

function isAdminRoute(route) {
  return route.startsWith("/admin");
}

async function pageDiagnostics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const textOverflow = [...document.querySelectorAll("button, .button, .admin-badge, .language-set button")]
      .filter((el) => el.offsetParent !== null && el.scrollWidth > el.clientWidth + 2)
      .map((el) => (el.textContent || "").trim().slice(0, 60));
    return {
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 2,
      brokenImages: [...document.images]
        .filter((img) => img.complete && img.naturalWidth === 0)
        .map((img) => img.getAttribute("src")),
      textOverflow,
      notifyText: /\bNotify Me\b/i.test(document.body?.innerText || ""),
      staleCache: document.documentElement.outerHTML.includes("20260701-logo"),
      bodyTextLength: document.body?.innerText?.length || 0,
    };
  });
}

async function checkPublicLanguage(page, route) {
  if (!(await page.locator('[data-language-option="es"]').count())) return [];
  const before = (await page.locator("h1").first().textContent().catch(() => "")) || "";
  await page.locator('[data-language-option="es"]').first().click();
  await page.waitForTimeout(80);
  const esLang = await page.locator("html").evaluate((el) => el.lang);
  const es = (await page.locator("h1").first().textContent().catch(() => "")) || "";
  await page.locator('[data-language-option="ko"]').first().click();
  await page.waitForTimeout(80);
  const koLang = await page.locator("html").evaluate((el) => el.lang);
  const ko = (await page.locator("h1").first().textContent().catch(() => "")) || "";
  const issues = [];
  if (esLang !== "es") issues.push(`${route}: Spanish switch did not set html lang`);
  if (koLang !== "ko") issues.push(`${route}: Korean switch did not set html lang`);
  if (before && es && before === es) issues.push(`${route}: Spanish h1 did not change`);
  if (before && ko && before === ko) issues.push(`${route}: Korean h1 did not change`);
  await page.locator('[data-language-option="en"]').first().click();
  await page.waitForTimeout(80);
  return issues;
}

async function checkMobileMenu(page, route) {
  if (!(await page.locator("[data-site-menu-toggle]").count())) return [];
  const before = await page.locator(".nav-links").first().evaluate((el) => getComputedStyle(el).display);
  await page.locator("[data-site-menu-toggle]").first().click();
  await page.waitForTimeout(80);
  const after = await page.locator(".nav-links").first().evaluate((el) => getComputedStyle(el).display);
  const expanded = await page.locator("[data-site-menu-toggle]").first().getAttribute("aria-expanded");
  const issues = [];
  if (before !== "none") issues.push(`${route}: mobile menu links should be collapsed initially`);
  if (after === "none") issues.push(`${route}: mobile menu links did not open`);
  if (expanded !== "true") issues.push(`${route}: mobile menu aria-expanded did not update`);
  await page.locator("[data-site-menu-toggle]").first().click();
  await page.waitForTimeout(80);
  return issues;
}

async function checkTrialMobilePosition(page) {
  return page.evaluate(() => {
    const form = document.querySelector("#business-application");
    return {
      formTop: form ? Math.round(form.getBoundingClientRect().top + window.scrollY) : null,
      hasJump: Boolean(document.querySelector(".trial-jump")),
    };
  });
}

async function checkAdminMobileNav(page, route) {
  if (route === "/admin/login/") return [];
  const nav = page.locator(".admin-shell .admin-bottom-nav").first();
  if (!(await nav.count())) return [`${route}: admin mobile navigation is missing`];
  const result = await nav.evaluate((el) => ({
    display: getComputedStyle(el).display,
    targets: [...el.querySelectorAll("a, button")].map((target) =>
      Math.round(target.getBoundingClientRect().height)),
  }));
  const issues = [];
  if (result.display === "none") issues.push(`${route}: admin mobile navigation is hidden`);
  if (result.targets.length < 5) issues.push(`${route}: admin mobile navigation is incomplete`);
  if (result.targets.some((height) => height < 48)) {
    issues.push(`${route}: admin mobile navigation has a touch target below 48px`);
  }
  return issues;
}

async function checkAdminDashboard(page) {
  const issues = [];
  await page
    .waitForFunction(() => document.querySelector("[data-admin-status]")?.textContent?.includes("Signed in"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/: summary did not load signed-in state"));
  await page
    .waitForFunction(() => document.querySelector("[data-service-alerts]")?.innerText?.includes("Sample Coffee"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/: service alerts did not populate"));
  const queueText = await page.locator("[data-action-queue-body]").innerText().catch(() => "");
  if (!queueText.includes("Claims are not turning into redemptions")) {
    issues.push("/admin/: unified action queue did not include business health");
  }
  const statusSelect = page.locator("[data-action-queue-body] .admin-queue-status-select").first();
  if (await statusSelect.count()) {
    await statusSelect.selectOption("reviewing");
    const updatedStatus = await statusSelect.inputValue().catch(() => "");
    if (updatedStatus !== "reviewing") issues.push("/admin/: queue workflow status did not update");
  } else {
    issues.push("/admin/: queue workflow status control is missing");
  }
  const recentText = await page.locator("[data-recent-deals-body]").innerText().catch(() => "");
  if (!recentText.includes("Morning pastry offer")) issues.push("/admin/: recent deal activity did not load");
  await page
    .waitForFunction(() => {
      const section = document.querySelector("[data-onboarding-section]");
      const text = document.querySelector("[data-onboarding-list]")?.textContent || "";
      return section && !section.hidden && text.includes("5 of 9 steps") && text.includes("Billing confirmed");
    }, null, { timeout: 5000 })
    .catch(() => issues.push("/admin/: guided onboarding panel did not load"));
  const draftEmail = page.locator("[data-service-alerts] button", { hasText: "Draft email" }).first();
  if (await draftEmail.count()) {
    await draftEmail.click();
    await page.locator("[data-owner-email-draft]").click();
    await page
      .waitForFunction(() => document.querySelector("[data-owner-email-subject]")?.value?.includes("Sample Coffee"), null, {
        timeout: 5000,
      })
      .catch(() => issues.push("/admin/: owner email draft workflow did not populate reviewed fields"));
    await page.locator("[data-owner-email-close]").click();
  } else {
    issues.push("/admin/: service alert owner-email action is missing");
  }
  const ownerView = page.locator("[data-service-alerts] button", { hasText: "View as owner" }).first();
  if (await ownerView.count()) {
    await ownerView.click();
    await page
      .waitForFunction(() => {
        const banner = document.querySelector("[data-owner-view-banner]")?.textContent || "";
        return document.body.classList.contains("is-owner-viewing")
          && banner.includes("Viewing as Sample Coffee")
          && document.querySelector("[data-owner-view]")?.textContent?.includes("Morning pastry offer");
      }, null, { timeout: 5000 })
      .catch(() => issues.push("/admin/: read-only owner view did not load with its safety banner"));
    await page.locator("[data-owner-view-exit]").click();
  } else {
    issues.push("/admin/: owner-view action is missing");
  }
  const openButton = page.locator("[data-recent-deals-body] button").first();
  if (await openButton.count()) {
    await openButton.click();
    await page
      .waitForFunction(() => document.querySelector("[data-business-panel-content]")?.innerText?.includes("Claims · 30d"), null, {
        timeout: 5000,
      })
      .catch(() => issues.push("/admin/: business activity side panel did not load"));
    await page.locator("[data-close-side-panel]").click();
  }
  const mobileLabels = await page.evaluate(() =>
    [...document.querySelectorAll(".admin-table[data-mobile-cards] tbody td")]
      .filter((td) => td.className !== "admin-row-detail")
      .every((td) => Boolean(td.dataset.label)),
  );
  if (!mobileLabels) issues.push("/admin/: generated mobile table cells are missing labels");
  return issues;
}

async function checkAccountRepair(page) {
  const issues = [];
  await page.locator("[data-repair-search-form] input[name=query]").fill("owner@example.com");
  await page.locator("[data-repair-search-form]").evaluate((form) => form.requestSubmit());
  await page
    .waitForFunction(() => document.querySelector("[data-repair-results]")?.textContent?.includes("Sample Coffee"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/account-repair/: account search did not return a result"));
  const open = page.locator("[data-repair-results] button").first();
  if (await open.count()) {
    await open.click();
    await page
      .waitForFunction(() => document.querySelector("[data-repair-detail]")?.textContent?.includes("1 enrolled"), null, {
        timeout: 5000,
      })
      .catch(() => issues.push("/admin/account-repair/: verified account summary did not load"));
  }
  const mobileLabels = await page.evaluate(() =>
    [...document.querySelectorAll(".admin-table[data-mobile-cards] tbody td")]
      .filter((td) => td.className !== "admin-row-detail")
      .every((td) => Boolean(td.dataset.label)),
  );
  if (!mobileLabels) issues.push("/admin/account-repair/: generated mobile table cells are missing labels");
  return issues;
}

async function checkAiUsage(page) {
  const issues = [];
  await page.locator("[data-ai-lookup-form] input[name=query]").fill("owner@example.com");
  await page.locator("[data-ai-lookup-form]").evaluate((form) => form.requestSubmit());
  await page
    .waitForFunction(() => document.querySelector("[data-ai-businesses]")?.textContent?.includes("Ad Generation"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/ai-usage/: quota lookup did not render"));
  return issues;
}

async function checkTrialRequests(page) {
  const issues = [];
  await page
    .waitForFunction(() => document.querySelector("[data-trial-requests-body]")?.innerText?.includes("Sample Bakery"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/admin/trial-requests/: applications did not load"));
  const setupButton = page.locator('button[data-decision="approve_setup"]').first();
  if (await setupButton.count()) {
    await setupButton.click();
    await page
      .waitForFunction(() => !document.querySelector("[data-trial-status]")?.textContent?.includes("Saving decision"), null, {
        timeout: 5000,
      })
      .catch(() => issues.push("/admin/trial-requests/: setup approval did not complete"));
    const decisionStatus = await page.locator("[data-trial-status]").textContent().catch(() => "");
    if (/NetworkError|Could not save decision/i.test(decisionStatus || "")) {
      issues.push(`/admin/trial-requests/: setup approval surfaced ${decisionStatus}`);
    }
  } else {
    issues.push("/admin/trial-requests/: setup approval button was missing");
  }
  const mobileLabels = await page.evaluate(() =>
    [...document.querySelectorAll(".admin-table[data-mobile-cards] tbody td")]
      .filter((td) => td.className !== "admin-row-detail")
      .every((td) => Boolean(td.dataset.label)),
  );
  if (!mobileLabels) issues.push("/admin/trial-requests/: generated mobile table cells are missing labels");
  return issues;
}

async function checkQrCampaigns(page) {
  const issues = [];
  await page
    .waitForFunction(() => document.querySelector("[data-qr-campaigns-body]")?.innerText?.includes("Sample Coffee"), null, { timeout: 5000 })
    .catch(() => issues.push("/admin/qr-campaigns/: campaigns did not load"));
  const qrButton = page.locator("button", { hasText: "Show QR" }).first();
  if (!(await qrButton.count())) return [...issues, "/admin/qr-campaigns/: Show QR button is missing"];
  await qrButton.click();
  await page
    .waitForFunction(() => document.querySelector("[data-qr-image]")?.getAttribute("src")?.startsWith("data:image/svg+xml"), null, { timeout: 5000 })
    .catch(() => issues.push("/admin/qr-campaigns/: QR image did not render"));
  const mobileLabels = await page.evaluate(() =>
    [...document.querySelectorAll(".admin-table[data-mobile-cards] tbody td")]
      .filter((td) => td.className !== "admin-row-detail")
      .every((td) => Boolean(td.dataset.label)),
  );
  if (!mobileLabels) issues.push("/admin/qr-campaigns/: generated mobile table cells are missing labels");
  return issues;
}

async function checkQuickApproval(page) {
  const issues = [];
  await page
    .waitForFunction(() => document.querySelector("[data-business-name]")?.textContent?.includes("Sample Bakery"), null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/quick-approve-trial/: preview did not load"));
  const confirmButton = page.locator("[data-confirm-quick-approval]");
  if (!(await confirmButton.count())) return [...issues, "/quick-approve-trial/: confirmation button is missing"];
  await confirmButton.click();
  await page
    .waitForFunction(() => document.querySelector("[data-quick-approval-result]")?.hidden === false, null, {
      timeout: 5000,
    })
    .catch(() => issues.push("/quick-approve-trial/: explicit confirmation did not reach the approved state"));
  return issues;
}

async function crawlRoute(browser, baseUrl, route, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await prepareStorage(context, route);
  const page = await context.newPage();
  await installMocks(page);

  const issues = [];
  // Headless Playwright auto-dismisses native dialogs unless handled, which
  // silently cancels window.confirm()-gated actions (e.g. the AI quota reset
  // confirmation) and looks like the app never responded.
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => issues.push(`${route} ${viewport.name}: page error ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`${route} ${viewport.name}: console error ${message.text()}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(baseUrl) && response.status() >= 400 && !url.endsWith("/favicon.ico")) {
      issues.push(`${route} ${viewport.name}: ${response.status()} ${url.replace(baseUrl, "")}`);
    }
  });

  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);

  const diagnostics = await pageDiagnostics(page);
  if (!diagnostics.bodyTextLength) issues.push(`${route} ${viewport.name}: body rendered empty`);
  if (diagnostics.horizontalOverflow) issues.push(`${route} ${viewport.name}: horizontal overflow`);
  if (diagnostics.brokenImages.length) issues.push(`${route} ${viewport.name}: broken images ${diagnostics.brokenImages.join(", ")}`);
  if (diagnostics.textOverflow.length) issues.push(`${route} ${viewport.name}: text overflow ${diagnostics.textOverflow.join(" | ")}`);
  if (diagnostics.notifyText) issues.push(`${route} ${viewport.name}: stale Notify Me copy is visible`);
  if (diagnostics.staleCache) issues.push(`${route} ${viewport.name}: stale 20260701 logo cache key`);

  if (isPublicRoute(route) && route !== "/business/" && viewport.name === "desktop") {
    issues.push(...(await checkPublicLanguage(page, route)));
  }
  if (isPublicRoute(route) && viewport.name === "mobile") {
    issues.push(...(await checkMobileMenu(page, route)));
  }
  if (isAdminRoute(route) && viewport.name === "mobile") {
    issues.push(...(await checkAdminMobileNav(page, route)));
  }
  if (route === "/business/start-trial/" && viewport.name === "mobile") {
    const trialMobile = await checkTrialMobilePosition(page);
    if (!trialMobile.hasJump) issues.push("/business/start-trial/: missing mobile form jump");
    if (trialMobile.formTop === null || trialMobile.formTop > 760) {
      issues.push(`/business/start-trial/: form starts too low on mobile (${trialMobile.formTop})`);
    }
  }
  if (route === "/admin/" && viewport.name === "mobile") issues.push(...(await checkAdminDashboard(page)));
  if (route === "/admin/account-repair/" && viewport.name === "mobile") issues.push(...(await checkAccountRepair(page)));
  if (route === "/admin/ai-usage/" && viewport.name === "mobile") issues.push(...(await checkAiUsage(page)));
  if (route === "/admin/offers/?view=redemptions" && viewport.name === "mobile") {
    const redemptionText = await page.locator("[data-rows]").innerText().catch(() => "");
    if (!redemptionText.includes("Staff Qr") || !redemptionText.includes("Morning pastry offer")) {
      issues.push("/admin/offers/?view=redemptions: redemption sibling view did not render");
    }
  }
  if (route === "/admin/trial-requests/" && viewport.name === "mobile") issues.push(...(await checkTrialRequests(page)));
  if (route === "/admin/qr-campaigns/" && viewport.name === "mobile") issues.push(...(await checkQrCampaigns(page)));
  if (route.startsWith("/quick-approve-trial/") && viewport.name === "mobile") issues.push(...(await checkQuickApproval(page)));

  if (SCREENSHOT_DIR && SCREENSHOT_ROUTES.has(route)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${viewport.name}-${safeName(route)}.png`),
      fullPage: true,
    });
  }

  await context.close();
  return issues;
}

async function main() {
  const server = createServer();
  const port = await listen(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];

  try {
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        failures.push(...(await crawlRoute(browser, baseUrl, route, viewport)));
      }
    }
  } finally {
    await browser.close();
    await closeServer(server);
  }

  if (failures.length > 0) {
    console.error("Website UI crawl failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(`Website UI crawl passed for ${ROUTES.length} routes across ${VIEWPORTS.length} viewports.`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
