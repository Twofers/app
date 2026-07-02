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

  function currentLocale() {
    const lang = (document.documentElement.lang || "en").toLowerCase();
    if (lang.startsWith("es")) return "es";
    if (lang.startsWith("ko")) return "ko";
    return "en";
  }

  function render() {
    const locale = currentLocale();
    document.querySelectorAll("[data-store-cta]").forEach((node) => {
      const platform = node.getAttribute("data-store-cta");
      const strings = STRINGS[locale] && STRINGS[locale][platform];
      if (!strings) return;

      const link = window.TWOFER_STORE_LINKS && window.TWOFER_STORE_LINKS[platform];
      node.textContent = strings.available;

      if (link) {
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
