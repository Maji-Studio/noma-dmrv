import { REPLY_LINE, sentToLine, type EmailContent, type Inline } from "./email-content";

const inlineText = (parts: Inline[]) => parts.map((p) => (typeof p === "string" ? p : p.strong)).join("");

/** Plain-text alternative. Layout independent: it carries the full link. */
export function renderPlainText(e: EmailContent): string {
  const lines = [e.heading, ""];
  if (e.change) lines.push(`${e.change.label}: ${e.change.from} → ${e.change.to}`, "");
  e.body.forEach((p, i) => {
    lines.push(inlineText(p));
    if (e.link && i === e.body.length - 1) lines.push(e.link.url);
    lines.push("");
  });
  if (e.action) lines.push(`${e.action.label}:`, e.action.url, "");
  if (e.note) lines.push(e.note, "");
  if (e.small) lines.push(e.small, "");
  lines.push(sentToLine(e.to, e.reason), REPLY_LINE);
  return `${lines.join("\n")}\n`;
}
