// PROTOTYPE ONLY. Shows the variant named in ?variant= (default A), mounts its visuals, drives the bar.
import { mountVisuals } from "../visuals/index.js";

const roots = [...document.querySelectorAll("[data-variant-key]")];
const keys = roots.map((r) => r.dataset.variantKey);
const bar = document.querySelector(".proto-bar");
const names = bar ? Object.fromEntries(JSON.parse(bar.dataset.variants).map((v) => [v.key, v.name])) : {};

function show(key, push) {
  if (!keys.includes(key)) key = keys[0];
  roots.forEach((r) => {
    const on = r.dataset.variantKey === key;
    r.hidden = !on;
    if (on && r.dataset.shown !== "true") { mountVisuals(r); r.dataset.shown = "true"; r.dispatchEvent(new CustomEvent("noma:shown")); }
  });
  if (bar) bar.querySelector(".proto-label").textContent = `${key} (${names[key] || ""})`;
  if (push) { const u = new URL(location.href); u.searchParams.set("variant", key); history.replaceState(null, "", u); window.scrollTo({ top: 0 }); }
}
const current = () => new URLSearchParams(location.search).get("variant") || keys[0];
const step = (d) => { const i = keys.indexOf(current()); show(keys[(i + d + keys.length) % keys.length], true); };
if (bar) {
  bar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => step(Number(b.dataset.step))));
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.closest && t.closest("input, textarea, select, [contenteditable], svg")) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
}
// Every variant reuses the same section ids, so resolve in-page links inside the visible variant only.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented) return;
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a || a.getAttribute("href").length < 2) return;
  const root = roots.find((r) => !r.hidden);
  const target = root && root.querySelector(a.getAttribute("href"));
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
});
show(bar ? current() : keys[0], false);
