// EmissionsSection. Hover, focus or tap a column to show its caption;
// on first view play the waterfall (data-em="armed" -> "play" -> "done") while the net figure counts down
// from the carbon stored. Without JS or with reduced motion the markup is the end state.
import { keepInView, onFirstView, reducedMotion } from "../motion.js";

const STACKED = "(max-width: 1100px)";

document.querySelectorAll("[data-em]").forEach((root) => {
  const cols = [...root.querySelectorAll("[data-em-col]")];
  const caps = [...root.querySelectorAll("[data-em-cap]")];
  const count = root.querySelector("[data-em-count]");
  let pinned = "";

  function focus(key) {
    if (key) root.dataset.emFocus = key;
    else delete root.dataset.emFocus;
    cols.forEach((c) => {
      c.classList.toggle("is-focus", c.dataset.emCol === key);
      if (c.matches("button")) c.setAttribute("aria-pressed", String(c.dataset.emCol === pinned));
    });
    caps.forEach((c) => c.classList.toggle("is-on", c.dataset.emCap === (key || "")));
  }
  root.classList.add("is-live");
  cols.forEach((c) => {
    c.removeAttribute("disabled");
    const key = c.dataset.emCol;
    c.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse" && !matchMedia(STACKED).matches) focus(key); });
    c.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !matchMedia(STACKED).matches) focus(pinned); });
    c.addEventListener("focus", () => focus(key));
    c.addEventListener("blur", () => focus(pinned));
    // Tap (touch) or click pins a column; a second tap on it unpins.
    c.addEventListener("click", () => {
      pinned = pinned === key ? "" : key;
      focus(pinned);
      if (matchMedia(STACKED).matches) keepInView(root.querySelector(".em-caps"));
    });
    c.addEventListener("keydown", (e) => {
      if (!c.matches("button") && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        pinned = pinned === key ? "" : key;
        focus(pinned);
      }
      if (e.key === "Escape") { pinned = ""; c.blur(); focus(""); }
    });
  });

  if (reducedMotion()) return;

  const stored = Number(root.dataset.emStored);
  const steps = [...root.querySelectorAll(".em-v [data-em-kg]")].map((c) => ({ at: Number(c.dataset.emAt), kg: Number(c.dataset.emKg) }));
  root.dataset.em = "armed";
  // Keep the final net value visible until its animation starts.
  onFirstView(root.querySelector("[data-em-chart]"), () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.dataset.em = "play";
      count.textContent = String(stored);
      let left = stored;
      steps.forEach((s) => setTimeout(() => { left -= s.kg; count.textContent = String(left); }, s.at));
      setTimeout(() => { root.dataset.em = "done"; }, Number(root.dataset.emDone));
    }));
  }, { threshold: 0.4 });
});
