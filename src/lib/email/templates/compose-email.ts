import type { EmailContent, RenderedEmail } from "./email-content";
import { renderHtml } from "./panel-layout";
import { renderPlainText } from "./plain-text";

/** Render one email in the current layout (panel-layout.ts) plus its text twin. */
export function composeEmail(content: EmailContent): RenderedEmail {
  return {
    subject: content.subject,
    preheader: content.preheader,
    html: renderHtml(content),
    text: renderPlainText(content),
  };
}
