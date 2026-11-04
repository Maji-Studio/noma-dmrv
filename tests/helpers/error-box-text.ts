/**
 * The error box splits a server message into a bold title and a detail, so the
 * message is no longer one text node. These compare a whole message with the
 * box's text, ignoring the whitespace the split drops.
 */
const squash = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, "");

/** For `contains` checks on `textContent` or a renderer's joined text. */
export const squashed = squash;

/** Testing Library matcher for the Notice that shows `message`. */
export function errorBox(message: string) {
  const wanted = squash(message);
  return (_content: string, element: Element | null) =>
    element?.hasAttribute("data-tone") === true && squash(element.textContent).includes(wanted);
}
