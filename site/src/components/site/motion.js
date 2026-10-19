// In-view motion helper. Content is complete at rest: without JS, or with reduced motion, nothing is
// ever hidden. With JS, reveal() arms each [data-reveal] element (data-reveal="armed" puts it in its
// start state via CSS), then flips it to data-reveal="play" the first time it scrolls into view, and to
// "done" once the choreography has finished. CSS owns the choreography; see stage/stage.css.
//
//   reveal(root?)                      arm every [data-reveal] under root (SiteShell calls it once)
//   onFirstView(el, cb, options?)      run cb(el) once, when el first intersects (immediately if no IO)
//   reducedMotion()                    true when the viewer prefers reduced motion
//   motionToken(name)                  a motion token from tokens.css, for JS-driven animation
//                                      (e.g. motionToken("--ease-draw"); durationMs() for CSS times)
//
// Optional attributes:
//   data-reveal-ms="2600"   when "done" is applied (default 3000)
//   data-reveal-trigger     on a descendant: observe that element instead of the whole [data-reveal]
//                           (a stage plays when its diagram is in view, not when the band's top edge is)
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const motionToken = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// CSS minifiers can turn 3000ms into 3s. JavaScript timers always need milliseconds.
export function durationMs(value, fallback = 0) {
  const match = value.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  return match ? Number(match[1]) * (match[2] === "s" ? 1000 : 1) : fallback;
}

// Explicit selections should reveal their result without moving keyboard focus.
export function keepInView(element) {
  const box = element.getBoundingClientRect();
  const top = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  if (box.top < top || box.bottom > innerHeight) {
    element.scrollIntoView({ block: "start", behavior: reducedMotion() ? "instant" : "smooth" });
  }
}

export function onFirstView(el, cb, { threshold = 0.3, rootMargin = "0px 0px -8% 0px" } = {}) {
  if (!("IntersectionObserver" in window)) { cb(el); return; }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    cb(el);
  }, { threshold, rootMargin });
  io.observe(el);
}

// Share of the trigger that must be on screen. A trigger taller than the viewport can never reach
// REVEAL_THRESHOLD, so a tall trigger plays once it fills REVEAL_FIT of the viewport (stacked mobile stages).
const REVEAL_THRESHOLD = 0.4;
const REVEAL_FIT = 0.35;
const REVEAL_MARGIN = "0px 0px -8% 0px";

export function reveal(root = document) {
  if (reducedMotion() || !("IntersectionObserver" in window)) return;
  root.querySelectorAll("[data-reveal]").forEach((el) => {
    if (el.dataset.reveal) return; // already armed, playing or done
    const trigger = el.querySelector("[data-reveal-trigger]") || el;
    const fit = (innerHeight * REVEAL_FIT) / Math.max(trigger.offsetHeight, 1);
    el.dataset.reveal = "armed";
    onFirstView(trigger, () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.dataset.reveal = "play";
        setTimeout(() => { el.dataset.reveal = "done"; }, Number(el.dataset.revealMs) || 3000);
      }));
    }, { threshold: Math.min(REVEAL_THRESHOLD, fit), rootMargin: REVEAL_MARGIN });
  });
}
