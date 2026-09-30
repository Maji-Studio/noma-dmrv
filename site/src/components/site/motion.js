// In-view motion helper. Content is complete at rest: without JS, or with reduced motion, nothing is
// ever hidden. With JS, reveal() arms each [data-reveal] element (data-reveal="armed" puts it in its
// start state via CSS), then flips it to data-reveal="play" the first time it scrolls into view, and to
// "done" once the choreography has finished. CSS owns the choreography; see stage/stage.css.
//
//   reveal(root?)                      arm every [data-reveal] under root (SiteShell calls it once)
//   onFirstView(el, cb, options?)      run cb(el) once, when el first intersects (immediately if no IO)
//   reducedMotion()                    true when the viewer prefers reduced motion
//
// Optional attribute: data-reveal-ms="2600" sets when "done" is applied (default 3000).
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function onFirstView(el, cb, { threshold = 0.3, rootMargin = "0px 0px -8% 0px" } = {}) {
  if (!("IntersectionObserver" in window)) { cb(el); return; }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    cb(el);
  }, { threshold, rootMargin });
  io.observe(el);
}

export function reveal(root = document) {
  if (reducedMotion() || !("IntersectionObserver" in window)) return;
  root.querySelectorAll("[data-reveal]").forEach((el) => {
    if (el.dataset.reveal) return; // already armed, playing or done
    el.dataset.reveal = "armed";
    onFirstView(el, () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.dataset.reveal = "play";
        setTimeout(() => { el.dataset.reveal = "done"; }, Number(el.dataset.revealMs) || 3000);
      }));
    });
  });
}
