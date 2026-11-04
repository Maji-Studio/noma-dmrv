/** Text as the operator reads it: elements are separated by a space. */
export function readableText(node: Node): string {
  const walk = (current: Node): string => current.nodeType === Node.TEXT_NODE
    ? current.textContent ?? ""
    : [...current.childNodes].map(walk).join(" ");
  return walk(node).replace(/\s+/g, " ");
}
