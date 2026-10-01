// Registry mapping (E): noma fields mapped row by row onto Isometric fields, then bundled.
import { esc, reduceMotion } from "./core.js";
import { MORPH } from "./data.js";

/** data-autoplay="visible" plays once when scrolled into view; data-button="false" hides the play button. */
export function mountMorph(root) {
  const withButton = root.dataset.button !== "false";
  root.classList.add("nv-morph-wrap");
  root.innerHTML = `${withButton ? `<div class="nv-morph-bar"><button type="button" class="nv-btn">Map to Isometric</button></div>` : ""}
  <div class="nv-morph"><div class="nv-m-head"><div>noma record</div><div></div><div>Isometric</div></div>${MORPH.map((m, i) => `<div class="nv-m-row" data-i="${i}">
    <div class="nv-m-chip nv-m-left"><div class="e">${esc(m[0])}</div><div class="f">${esc(m[1])}</div><div class="v">${esc(m[2])}</div></div>
    <svg class="nv-m-link" viewBox="0 0 86 24" preserveAspectRatio="none" aria-hidden="true"><path d="M2 12 C30 12 56 12 84 12"/></svg>
    <div class="nv-m-chip nv-m-right"><div class="e">${esc(m[3])}</div><div class="f">${esc(m[4])}</div><div class="v">${esc(m[5])}</div></div></div>`).join("")}
  <div class="nv-m-bundle"><span class="nv-chip nv-chip-off">Waiting</span><div><b>Removal RM-2026-004</b><div class="nv-hint">Readiness check, then one submission: sources, production batch, datapoints, applications, samples, GHG entry.</div></div></div></div>`;
  let timer = null;
  const rows = [...root.querySelectorAll(".nv-m-row")], bundle = root.querySelector(".nv-m-bundle"), chip = bundle.querySelector(".nv-chip");
  const play = () => {
    clearTimeout(timer);
    rows.forEach((r) => r.classList.remove("done", "active"));
    bundle.classList.remove("done"); chip.className = "nv-chip nv-chip-off"; chip.textContent = "Mapping";
    let i = 0;
    const step = () => {
      if (i > 0) rows[i - 1].classList.replace("active", "done");
      if (i < rows.length) { rows[i].classList.add("active"); i++; timer = setTimeout(step, reduceMotion() ? 10 : 520); }
      else { bundle.classList.add("done"); chip.className = "nv-chip nv-chip-ok"; chip.textContent = "Bundled"; }
    };
    step();
  };
  if (withButton) root.querySelector(".nv-btn").addEventListener("click", play);
  if (root.dataset.autoplay === "visible") {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); play(); } }, { threshold: 0.4 });
    io.observe(root);
  }
  return { play };
}
