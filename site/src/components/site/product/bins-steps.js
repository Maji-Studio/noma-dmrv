// BinsSection stepper. Arms the stage (.is-live, tabs and Back / Next shown), parks the squares above the bin
// (step 0) and fills the bin on first view. Tabs jump to a step; Next walks forward and, on the last step,
// starts again with a fresh fill. data-step on the stage drives the picture (bins-steps.css).
import { onFirstView, reducedMotion } from "../motion.js";

document.querySelectorAll("[data-bs]").forEach((root) => {
  const tabs = [...root.querySelectorAll("[data-bs-go]")];
  const panels = [...root.querySelectorAll("[data-bs-panel]")];
  const back = root.querySelector("[data-bs-back]");
  const next = root.querySelector("[data-bs-next]");
  const names = tabs.map((t) => t.textContent.replace(/^\d+/, "").trim());
  const last = tabs.length;
  let step = 0;

  function go(k) {
    step = k;
    root.dataset.step = String(k);
    const shown = Math.max(k, 1);
    tabs.forEach((t, i) => {
      t.toggleAttribute("aria-current", i + 1 === shown);
      if (i + 1 === shown) t.setAttribute("aria-current", "step");
      t.toggleAttribute("data-done", i + 1 < shown);
    });
    panels.forEach((p, i) => p.classList.toggle("is-on", i + 1 === shown));
    back.disabled = shown === 1;
    next.textContent = shown === last ? "Start again" : `Next: ${names[shown]}`;
  }

  // Park the squares above the bin, let the browser paint that, then drop them in.
  function fill() {
    if (reducedMotion()) return go(1);
    go(0);
    requestAnimationFrame(() => requestAnimationFrame(() => go(1)));
  }

  root.classList.add("is-live");
  root.querySelector(".bs-tabs").hidden = false;
  root.querySelector(".bs-nav").hidden = false;
  tabs.forEach((t) => t.addEventListener("click", () => go(Number(t.dataset.bsGo))));
  back.addEventListener("click", () => go(Math.max(1, step - 1)));
  next.addEventListener("click", () => (step >= last ? fill() : go(step + 1)));

  go(reducedMotion() ? 1 : 0);
  onFirstView(root, () => { if (step === 0) fill(); });
});
