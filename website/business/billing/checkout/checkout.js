(() => {
  const endpoint = document.body.dataset.checkoutEndpoint;
  const headingEl = document.querySelector("[data-checkout-heading]");
  const messageEl = document.querySelector("[data-checkout-message]");
  const statusEl = document.querySelector("[data-checkout-status]");
  const actionsEl = document.querySelector("[data-checkout-actions]");
  const fallbackNoteEl = document.querySelector("[data-store-fallback-note]");

  function tokenFromPath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    const index = segments.indexOf("checkout");
    return index >= 0 ? segments[index + 1] || "" : "";
  }

  function showActions() {
    if (actionsEl) actionsEl.hidden = false;
  }

  function render(heading, message, status) {
    if (headingEl) headingEl.textContent = heading;
    if (messageEl) messageEl.textContent = message;
    if (statusEl) statusEl.textContent = status || "";
  }

  function renderSignupRequired() {
    render(
      "Almost there",
      "Your business is approved for setup. Sign in with the approved email to claim it before starting Checkout.",
      "",
    );
    if (fallbackNoteEl) fallbackNoteEl.hidden = false;
    showActions();
  }

  function renderProblem(message) {
    render("We couldn't open checkout", message, "");
    showActions();
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  async function start() {
    const token = tokenFromPath();
    if (!endpoint || !token) {
      renderProblem("This link isn't available. Email support@twoferapp.com.");
      return;
    }
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const payload = await readJson(response);

      if (response.ok && payload.ok && payload.url) {
        render("Redirecting to checkout", "Taking you to secure Stripe checkout…", "Redirecting…");
        window.location.href = payload.url;
        return;
      }

      if (payload.reason === "signup_required") {
        renderSignupRequired();
        return;
      }
      if (payload.reason === "expired") {
        renderProblem("This link has expired. Email support@twoferapp.com and we'll send a new one.");
        return;
      }
      if (payload.reason === "rate_limited") {
        renderProblem("Too many attempts. Please wait a few minutes and open this link again.");
        return;
      }
      renderProblem(payload.error || "Checkout isn't available right now. Email support@twoferapp.com.");
    } catch {
      renderProblem("We couldn't reach checkout. Check your connection and try again, or email support@twoferapp.com.");
    }
  }

  start();
})();
