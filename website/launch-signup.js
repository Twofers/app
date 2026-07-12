// Pre-launch email capture for the "email me launch updates" forms on the
// homepage. Visibility is controlled by store-links.js: once real store links
// exist, these forms disappear along with the rest of the fallback UI.
// Submissions go to the submit-launch-signup edge function; if that call
// fails for any reason, the visitor is pointed at support@twoferapp.com so
// nobody hits a dead end.
(() => {
  const endpoint = document.body.dataset.launchSignupEndpoint;

  function msg(key, fallback) {
    return window.TwoferI18n?.t(key) || fallback;
  }

  function setStatus(form, text, isError) {
    const statusEl = form.querySelector("[data-signup-status]");
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `status${isError ? " error" : ""}`;
  }

  document.querySelectorAll("[data-launch-signup]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const emailInput = form.querySelector('input[type="email"]');
      const submitButton = form.querySelector('button[type="submit"]');
      const email = String(emailInput?.value || "").trim();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setStatus(form, msg("home.signupInvalid", "Enter a valid email address."), true);
        emailInput?.focus();
        return;
      }
      if (!endpoint) {
        setStatus(form, msg("home.signupError", "We could not save your email. Write to support@twoferapp.com."), true);
        return;
      }

      if (submitButton) submitButton.disabled = true;
      setStatus(form, msg("home.signupSubmitting", "Saving..."), false);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            locale: (document.documentElement.lang || "en").slice(0, 2),
            source: form.dataset.signupSource || "website",
            company_website: String(form.querySelector('input[name="company_website"]')?.value || ""),
          }),
        });
        if (response.status === 429) {
          setStatus(form, msg("home.signupRateLimited", "Too many tries for now. Please try again later."), true);
          return;
        }
        if (!response.ok) throw new Error("Request failed");
        if (emailInput) emailInput.hidden = true;
        if (submitButton) submitButton.hidden = true;
        setStatus(form, msg("home.signupSuccess", "Thanks! We will email you when Twofer launches."), false);
      } catch {
        setStatus(form, msg("home.signupError", "We could not save your email. Write to support@twoferapp.com."), true);
      } finally {
        if (submitButton && !submitButton.hidden) submitButton.disabled = false;
      }
    });
  });
})();
