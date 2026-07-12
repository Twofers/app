// Single place to drop in the real store URLs once they exist. Until then,
// store CTAs stay hidden so the site never shows fake download or notify links.
window.TWOFER_STORE_LINKS = {
  ios: null, // e.g. "https://apps.apple.com/app/id0000000000"
  android: null, // e.g. "https://play.google.com/store/apps/details?id=com.unvmex2.twoforone"
};

(() => {
  const STRINGS = {
    en: {
      ios: { available: "Get Twofer for iPhone" },
      android: { available: "Get Twofer for Android" },
    },
    es: {
      ios: { available: "Obtener Twofer para iPhone" },
      android: { available: "Obtener Twofer para Android" },
    },
    ko: {
      ios: { available: "iPhone용 Twofer 받기" },
      android: { available: "Android용 Twofer 받기" },
    },
  };

  const FALLBACK_TEXT = {
    en: "Email me launch updates",
    es: "Avísenme cuando la app esté lista",
    ko: "앱 준비되면 알려주세요",
  };

  function currentLocale() {
    const lang = (document.documentElement.lang || "en").toLowerCase();
    if (lang.startsWith("es")) return "es";
    if (lang.startsWith("ko")) return "ko";
    return "en";
  }

  function render() {
    const locale = currentLocale();
    let anyLinkReady = false;
    document.querySelectorAll("[data-store-cta]").forEach((node) => {
      const platform = node.getAttribute("data-store-cta");
      const strings = STRINGS[locale] && STRINGS[locale][platform];
      if (!strings) return;

      const link = window.TWOFER_STORE_LINKS && window.TWOFER_STORE_LINKS[platform];
      node.textContent = strings.available;

      if (link) {
        anyLinkReady = true;
        node.hidden = false;
        node.dataset.storeReady = "true";
        node.removeAttribute("aria-hidden");
        node.removeAttribute("tabindex");
        node.href = link;
        node.target = "_blank";
        node.rel = "noopener";
        return;
      }

      node.hidden = true;
      delete node.dataset.storeReady;
      node.setAttribute("aria-hidden", "true");
      node.setAttribute("tabindex", "-1");
      node.removeAttribute("href");
      node.removeAttribute("target");
      node.removeAttribute("rel");
    });

    // If neither store link is live yet, every data-store-cta button on the
    // page is hidden. Without this, a section built around "get the app"
    // (e.g. the customer feature grid) would show no working action at all.
    document.querySelectorAll("[data-store-fallback]").forEach((node) => {
      node.hidden = anyLinkReady;
      node.textContent = FALLBACK_TEXT[locale] || FALLBACK_TEXT.en;
    });

    // The launch-signup email forms (launch-signup.js) follow the same rule:
    // visible only while no store link is live.
    document.querySelectorAll("[data-store-fallback-note], [data-launch-signup]").forEach((node) => {
      node.hidden = anyLinkReady;
    });
  }

  function boot() {
    render();
    document.querySelectorAll("[data-language-option]").forEach((node) => {
      node.addEventListener("click", () => window.setTimeout(render, 0));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener("twofer:localechange", render);
})();
