// EmissionsSection. Hover, focus or tap a column to show its caption;
// on first view play the waterfall (data-em="armed" -> "play" -> "done") while the net figure counts down
// from the carbon stored. Without JS or with reduced motion the markup is the end state.
import { onFirstView, reducedMotion } from "../motion.js";

document.querySelectorAll("[data-em]").forEach((root) => {
  const cols = [...root.querySelectorAll("[data-em-col]")];
  const caps = [...root.querySelectorAll("[data-em-cap]")];
  const count = root.querySelector("[data-em-count]");
  let pinned = "";

  function focus(key) {
    if (key) root.dataset.emFocus = key;
    else delete root.dataset.emFocus;
    cols.forEach((c) => c.classList.toggle("is-focus", c.dataset.emCol === key));
    caps.forEach((c) => c.classList.toggle("is-on", c.dataset.emCap === (key || "")));
  }
  root.classList.add("is-live");
  cols.forEach((c) => {
    const key = c.dataset.emCol;
    c.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") focus(key); });
    c.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") focus(pinned); });
    c.addEventListener("focus", () => focus(key));
    c.addEventListener("blur", () => focus(pinned));
    // Tap (touch) or click pins a column; a second tap on it unpins.
    c.addEventListener("click", () => { pinned = pinned === key ? "" : key; focus(pinned); });
    c.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { pinned = ""; c.blur(); focus(""); }
    });
  });

  if (reducedMotion()) return;

  const stored = Number(root.dataset.emStored);
  const steps = [...root.querySelectorAll(".em-v [data-em-kg]")].map((c) => ({ at: Number(c.dataset.emAt), kg: Number(c.dataset.emKg) }));
  root.dataset.em = "armed";
  count.textContent = String(stored);
  onFirstView(root.querySelector("[data-em-chart]"), () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.dataset.em = "play";
      let left = stored;
      steps.forEach((s) => setTimeout(() => { left -= s.kg; count.textContent = String(left); }, s.at));
      setTimeout(() => { root.dataset.em = "done"; }, Number(root.dataset.emDone));
    }));
  }, { threshold: 0.4 });
});
