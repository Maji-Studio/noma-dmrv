/**
 * A success toast that waits for the page the operator is being taken to.
 *
 * A delete that ends on a list used to toast first and navigate second, so the
 * message sat over a page that had not moved and, with the dialog gone, nothing
 * on screen was busy. The flow now keeps its dialog busy through the
 * navigation (`useNavigateWithToast`) and queues the message here; the toast
 * provider shows it once the destination path has rendered, so the list and
 * the message arrive together and a toast never appears beside a busy dialog.
 *
 * This is the in-app counterpart of `pending-warning.ts`, which carries a
 * warning across a full page load. An in-app navigation keeps the document,
 * so a module variable is enough.
 */
type Arrival = { pathname: string; message: string };

let queued: Arrival | null = null;

/** Hold `message` until `pathname` renders. A newer call replaces an older one. */
export function queueArrivalToast(pathname: string, message: string): void {
  queued = { pathname, message };
}

/**
 * Called when the rendered path changes. Answers the message when this is the
 * queued destination; any other path drops the entry, so a navigation that
 * went elsewhere never shows a stale toast later.
 */
export function takeArrivalToast(pathname: string | null): string | null {
  const arrival = queued;
  queued = null;
  return arrival && arrival.pathname === pathname ? arrival.message : null;
}
