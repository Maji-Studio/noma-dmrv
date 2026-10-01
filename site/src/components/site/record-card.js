// Record card in the browser: the same markup as RecordCard.astro (keep the two in step), for cards built
// on hover or per map stop. Text is set with textContent only. art is a ContourArt node (contourNode() in
// contours/index.js, or a copy of one already on the page); without it the card is text only.
import "./contours/contour-art.css";
import "./record-card.css";

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** holds: items or [label, value] pairs. accent: the floating card's top edge (e.g. "var(--prod)"). */
export function recordCard({ label, code, line, holds = [], art = null, tone = "paper", float = false, accent }) {
  const card = el("article", ["rc", tone === "stage" && "rc--stage", float && "rc--float"].filter(Boolean).join(" "));
  if (accent) card.style.setProperty("--rc-accent", accent);
  const inner = el("div", "rc-in");
  if (art) { art.classList.add("rc-art"); inner.append(art); }
  const text = el("div", "rc-text");
  const head = el("p", "rc-head");
  head.append(el("span", "rc-label", label), el("span", "rc-code", code));
  text.append(head);
  if (line) text.append(el("p", "rc-line", line));
  if (holds.length) {
    const list = el("ul", "rc-holds");
    for (const h of holds) {
      const item = el("li", null, Array.isArray(h) ? null : h);
      if (Array.isArray(h)) item.append(el("span", "rc-key", h[0]), el("span", null, h[1]));
      list.append(item);
    }
    text.append(list);
  }
  inner.append(text);
  card.append(inner);
  return card;
}
