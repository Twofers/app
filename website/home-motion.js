// Homepage scroll reveals. Progressive enhancement only: without JS (or with
// reduced motion) every section renders fully visible -- the CSS hides
// nothing until this script tags the page with .motion-ready. styles.css
// also forces everything visible under @media print.
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches) return;
  if (!("IntersectionObserver" in window)) return;

  const targets = [...document.querySelectorAll("[data-reveal]")];
  if (!targets.length) return;

  document.documentElement.classList.add("motion-ready");

  const revealAll = () => {
    targets.forEach((node) => node.classList.add("revealed"));
  };

  // Anything already at or above the current viewport (deep links, restored
  // scroll positions) shows immediately -- only content the visitor actually
  // scrolls down to gets the entrance.
  const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
  targets.forEach((node) => {
    if (node.getBoundingClientRect().top < viewportBottom) node.classList.add("revealed");
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      });
    },
    // Generous pre-reveal margin: fires while the section is still just below
    // the fold, so fast scrolling never outruns the entrance.
    { rootMargin: "0px 0px 20% 0px", threshold: 0.01 }
  );

  targets.forEach((node) => {
    if (!node.classList.contains("revealed")) observer.observe(node);
  });

  // Printing and reduced-motion changes must never hide content.
  window.addEventListener("beforeprint", revealAll);
  if (typeof reduced.addEventListener === "function") {
    reduced.addEventListener("change", () => {
      if (reduced.matches) {
        revealAll();
        observer.disconnect();
      }
    });
  }
})();
