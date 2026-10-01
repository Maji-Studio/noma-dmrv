// A disclosure, not a modal: links follow the toggle in the normal tab order.
// Without JavaScript all destinations remain visible.
const header = document.querySelector(".site-header");
const toggle = header?.querySelector(".site-menu-toggle");
const menu = header?.querySelector(".site-menu");
const MOBILE_NAV = "(max-width: 900px)";

if (header && toggle && menu) {
  const mobile = matchMedia(MOBILE_NAV);
  const label = toggle.querySelector("[data-menu-label]");
  const setOpen = (open, restoreFocus = false) => {
    toggle.setAttribute("aria-expanded", String(open));
    label.textContent = open ? "Close" : "Menu";
    menu.hidden = mobile.matches && !open;
    if (restoreFocus) toggle.focus();
  };
  const sync = () => {
    const focusWasInside = menu.contains(document.activeElement);
    const focusWasToggle = document.activeElement === toggle;
    toggle.hidden = !mobile.matches;
    setOpen(false, mobile.matches && focusWasInside);
    if (!mobile.matches && focusWasToggle) menu.querySelector("a")?.focus();
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobile.matches && !menu.hidden) {
      setOpen(false, true);
    }
  });
  document.addEventListener("click", (event) => {
    if (mobile.matches && !menu.hidden && !header.contains(event.target)) setOpen(false);
  });
  header.addEventListener("focusout", (event) => {
    if (mobile.matches && event.relatedTarget && !header.contains(event.relatedTarget)) setOpen(false);
  });
  menu.addEventListener("click", (event) => {
    if (mobile.matches && event.target.closest("a")) setOpen(false, true);
  });
  mobile.addEventListener("change", sync);
  sync();
}
