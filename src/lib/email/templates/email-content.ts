/** Layout-independent description of one transactional email. */

/** A run of text; `{ strong }` renders bold. Values are escaped by the renderers. */
export type Inline = string | { strong: string };

/** Drawings shipped in public/email as `<name>.png` and `<name>-dark.png`. */
export type EmailArt = "invitation" | "password-reset" | "verify-email";

export type EmailContent = {
  subject: string;
  /** Inbox preview line. */
  preheader: string;
  art: EmailArt;
  heading: string;
  /** Paragraphs above the button. */
  body: Inline[][];
  action: { label: string; url: string };
  /** Deadline line under the written-out link. */
  note: string;
  /** Last paragraph, after a divider. */
  small: string;
  /** Recipient address. */
  to: string;
  /** Completes "Sent to <address> ...". */
  reason: string;
  /** App origin that serves public/email images. */
  appUrl: string;
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};
