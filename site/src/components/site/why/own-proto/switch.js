// PROTOTYPE ONLY. Shows the ownership variant named in ?own= (default 0, the current proof) and drives the
// floating bar.
const roots = [...document.querySelectorAll("[data-own-variant]")];
const keys = roots.map((r) => r.dataset.ownVariant);
const bar = document.querySelector("#ownership .proto-bar");
const names = bar ? Object.fromEntries(JSON.parse(bar.dataset.variants).map((v) => [v.key, v.name])) : {};
const section = () => document.getElementById("ownership");

function show(key, push) {
  if (!keys.includes(key)) key = keys[0];
  roots.forEach((r) => { r.hidden = r.dataset.ownVariant !== key; });
  if (bar) bar.querySelector(".proto-label").textContent = `Ownership ${key} (${names[key] || ""})`;
  if (push) {
    const u = new URL(location.href); u.searchParams.set("own", key); history.replaceState(null, "", u);
    section().scrollIntoView({ block: "start" });
  }
}
const current = () => new URLSearchParams(location.search).get("own") || keys[0];
const step = (d) => { const i = keys.indexOf(current()); show(keys[(i + d + keys.length) % keys.length], true); };
if (bar) {
  bar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => step(Number(b.dataset.step))));
  document.addEventListener("keydown", (e) => {
    const t = e.target;
    if (t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });
}
show(current(), false);
if (new URLSearchParams(location.search).has("own")) requestAnimationFrame(() => section().scrollIntoView({ block: "start" }));
