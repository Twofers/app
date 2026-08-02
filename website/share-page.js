// Shared-offer preview state for /s/<CODE>. Served from the site root:
// every /s/* path is claimed by rewrites, which shadow real files there.
//
// Page-local, not shared: this file exists as a separate script only so the
// public Content-Security-Policy can enforce `script-src 'self'` with no
// inline-script allowance. It is loaded end-of-body, after localization.js and
// store-links.js, exactly where the inline version used to run.
//
// State-aware share preview (audit F-009). Mirrors the app's parser
// (lib/deal-share-link.ts): /s/<7-char code>, alphabet without 0/O/I/L/1.
(function () {
  var CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$/;
  var endpoint = document.body.getAttribute("data-share-lookup-endpoint");
  var result = document.querySelector("[data-share-result]");
  if (!endpoint || !result) return;

  function show(state) {
    var panels = result.querySelectorAll("[data-share-state]");
    for (var i = 0; i < panels.length; i += 1) {
      panels[i].hidden = panels[i].getAttribute("data-share-state") !== state;
    }
  }

  var match = window.location.pathname.match(/^\/s\/([^\/]+)\/?$/);
  if (!match) return; // bare /s — keep the static copy only.
  var code;
  try {
    code = decodeURIComponent(match[1]).trim().toUpperCase();
  } catch (_e) {
    code = "";
  }
  if (!CODE_RE.test(code)) {
    show("unavailable");
    return;
  }

  show("checking");
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code }),
  })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (payload) {
      var share = payload && payload.share ? payload.share : null;
      var status = share && typeof share.share_status === "string" ? share.share_status : "not_found";
      if (status === "valid") {
        var title = result.querySelector("[data-share-deal-title]");
        var business = result.querySelector("[data-share-business]");
        var ends = result.querySelector("[data-share-ends]");
        if (title) title.textContent = share.deal_title || "";
        if (business) {
          business.textContent = [share.business_name, share.business_address]
            .filter(Boolean)
            .join(" · ");
        }
        if (ends) {
          var when = share.deal_end_time ? new Date(share.deal_end_time) : null;
          ends.textContent = when && !isNaN(when.getTime())
            ? when.toLocaleString(document.documentElement.lang || undefined, {
                month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
              })
            : "";
        }
        show("valid");
      } else if (status === "expired") {
        show("expired");
      } else {
        show("unavailable");
      }
    })
    .catch(function () {
      show("error");
    });
})();
