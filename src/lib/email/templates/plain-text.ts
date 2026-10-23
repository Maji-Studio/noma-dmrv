import { REPLY_LINE, sentToLine, type EmailContent, type Inline } from "./email-content";

const inlineText = (parts: Inline[]) => parts.map((p) => (typeof p === "string" ? p : p.strong)).join("");

/** Plain-text alternative. Layout independent: it carries the full link. */
export function renderPlainText(e: EmailContent): string {
  const lines = [e.heading, ""];
  for (const p of e.body) lines.push(inlineText(p), "");
  lines.push(`${e.action.label}:`, e.action.url, "", e.note, "", e.small, "");
  lines.push(sentToLine(e.to, e.reason), REPLY_LINE);
  return `${lines.join("\n")}\n`;
}
