// AccordionShowcase behaviour. The server renders every item open (the no-JS state); mounting marks the
// root data-acc-ready, which switches on the closed states in accordion-showcase.css, then opens the first.
// Panels carry data-open; visuals carry data-open (their item is open, used below 900px where the visual
// sits in the panel) and data-shown (the right-hand visual, which stays on the last opened item).
// The first render skips transitions (data-acc-still) so nothing animates shut on load.

const KEYS = { ArrowDown: 1, ArrowUp: -1 };

export function mountAccordion(root) {
  const buttons = [...root.querySelectorAll(":scope > .acc-h > .acc-btn")];
  const items = buttons.map((btn) => ({
    btn,
    head: btn.parentElement,
    panel: document.getElementById(btn.dataset.panel),
    visual: document.getElementById(btn.dataset.visual),
  }));
  let open = 0;
  let shown = 0;

  function render() {
    items.forEach(({ btn, head, panel, visual }, i) => {
      const on = i === open;
      btn.setAttribute("aria-expanded", String(on));
      head.toggleAttribute("data-open", on);
      panel.toggleAttribute("data-open", on);
      visual.toggleAttribute("data-open", on);
      visual.toggleAttribute("data-shown", i === shown);
    });
  }

  function set(i) {
    open = i;
    if (i >= 0) shown = i;
    render();
    root.dispatchEvent(new CustomEvent("accordion:open", {
      detail: { index: i, id: i >= 0 ? items[i].btn.id : null, visual: i >= 0 ? items[i].visual : null },
    }));
  }

  buttons.forEach((btn, i) => btn.addEventListener("click", () => set(open === i ? -1 : i)));

  root.addEventListener("keydown", (e) => {
    const at = buttons.indexOf(e.target);
    if (at < 0) return;
    let next = null;
    if (e.key in KEYS) next = (at + KEYS[e.key] + buttons.length) % buttons.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = buttons.length - 1;
    if (next === null) return;
    e.preventDefault();
    buttons[next].focus();
  });

  root.setAttribute("data-acc-still", "");
  root.setAttribute("data-acc-ready", "");
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute("data-acc-still")));
}
