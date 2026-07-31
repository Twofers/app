const {
  activeState,
  clearState,
  edgeFunction,
  sameOrigin,
} = require("../../server/admin-session");

const ALLOWED_FUNCTIONS = new Set([
  "admin-dashboard-summary",
  "admin-ai-usage",
  "admin-account-management",
  "admin-business-applications",
  "admin-onboarding-review-ai",
  "admin-business-name-requests",
  "admin-reports",
  "admin-promo-authorization",
  "admin-qr-campaigns",
  "admin-prospect-import",
  "admin-prospect-enrich",
  "admin-prospect-score",
  "admin-prospect-sales",
  "admin-sales-script",
  "admin-demand-proof",
  "admin-claim-link-create",
  "admin-claim-link-assistant",
  "admin-trial-create-from-prospect",
  "admin-trial-conversion-assistant",
  "admin-ai-prompts",
  "admin-ai-operating-report",
  "admin-ai-cost-ledger-reset",
  "admin-owner-email",
]);

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });
  if (!sameOrigin(req)) return send(res, 403, { error: "Invalid request origin." });

  const functionName = String(req.query?.function || "");
  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    return send(res, 404, { error: "Unknown admin function." });
  }

  const state = await activeState(req, res);
  if (!state) return send(res, 401, { error: "Admin session expired." });

  const { response, payload } = await edgeFunction(
    functionName,
    req.body || {},
    state.session.access_token,
  );
  if (response.status === 401) clearState(res);
  return send(res, response.status, payload);
};
