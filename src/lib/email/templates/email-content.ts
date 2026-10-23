/** Layout-independent description of one transactional email. */

/** A run of text; `{ strong }` renders bold. Values are escaped by the renderers. */
export type Inline = string | { strong: string };

/** Drawings shipped in public/email as `<name>.png` and `<name>-dark.png`. */
export type EmailArt =
  | "invitation"
  | "password-reset"
  | "verify-email"
  | "password-changed"
  | "role-changed"
  | "removed"
  | "email-change";

export type EmailContent = {
  subject: string;
  /** Inbox preview line. */
  preheader: string;
  art: EmailArt;
  heading: string;
  /** Before → after block above the body, e.g. a role or address change. */
  change?: { label: string; from: string; to: string };
  /** Paragraphs above the button. */
  body: Inline[][];
  /** Plain link line right after the last body paragraph (notices without a button). */
  link?: { text: string; url: string };
  /** Primary button; a notice that needs no action omits it. */
  action?: { label: string; url: string };
  /** Deadline line under the written-out link. */
  note?: string;
  /** Last paragraph, after a divider. */
  small?: string;
  /** Recipient address. */
  to: string;
  /** Completes "Sent to <address> ...". */
  reason: string;
  /** App origin that serves public/email images. */
  appUrl: string;
};

/** Footer lines every email shares; both renderers use these. */
export const sentToLine = (to: string, reason: string) => `Sent to ${to} ${reason}`;
export const REPLY_LINE = "Questions? Reply to this email.";

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};
