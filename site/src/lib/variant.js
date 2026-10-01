// Runs fn(root) once, the first time variant `key` is shown by the switcher.
// Variants live on one page; hidden ones must not set up observers or animations early.
export function onShown(key, fn) {
  const root = document.querySelector(`[data-variant-key="${key}"]`);
  if (!root) return;
  if (root.dataset.shown === "true") fn(root);
  else root.addEventListener("noma:shown", () => fn(root), { once: true });
}
