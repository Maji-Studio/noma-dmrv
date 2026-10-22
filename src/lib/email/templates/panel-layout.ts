/**
 * Layout A "Panel": logo on the warm field, one white panel with a plum
 * hairline, the drawing in a small tile above the heading, footer on the field.
 * Table based, inline styles, no inline SVG or CSS background images. Light
 * values are inline; dark values live in one <style> block (Apple Mail, Outlook
 * for Mac and iOS Mail honour it). Clients that force-invert (Gmail apps) leave
 * images alone, so every light image is opaque with its cell colour baked in.
 *
 * This is the only file that knows the look. Switching to another layout means
 * replacing this file; content, text and the email functions stay untouched.
 */
import { escapeHtml } from "../escape-html";
import type { EmailContent, Inline } from "./email-content";

// Opaque twins of the app's plum alphas over white (globals.css two-greys rule).
const LIGHT = {
  field: "#fff9f7",
  paper: "#ffffff",
  ink: "#0f021a",
  text2: "#574e5f",
  text3: "#6f6776",
  hair: "#e7e6e8",
  panel: "#9f9aa3",
} as const;
const DARK = {
  field: "#140a1b",
  paper: "#1d1226",
  ink: "#f7f1f9",
  text2: "#d2c9d8",
  text3: "#b3a9ba",
  hair: "#3a2f42",
  panel: "#5d5266",
  btnBg: "#fff9f7",
  btnText: "#0f021a",
} as const;

const SANS = "'GT-Flexa', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'GT-Flexa-Mono', Menlo, Monaco, Consolas, 'Courier New', monospace";

const MAX_WIDTH = 600;
const PHONE_BREAKPOINT = 600;
const LOGO_SIZE = 40;
const ART_WIDTH = 96;
const ART_HEIGHT = 72;
const IMAGE_PATH = "/email";
const PREHEADER_PAD = "&#847;&zwnj;&nbsp;".repeat(60);
const DISPLAY_NONE = "display:none;max-height:0;overflow:hidden;mso-hide:all;";
const WRAP_LINK = "word-break:break-word;overflow-wrap:anywhere;";

const inline = (parts: Inline[]) =>
  parts
    .map((p) => (typeof p === "string" ? escapeHtml(p) : `<strong style="font-weight:600;">${escapeHtml(p.strong)}</strong>`))
    .join("");

function head(subject: string): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; -webkit-text-size-adjust: 100%; }
  table { border-collapse: collapse; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  .d-img { display: none; }
  @media (max-width: ${PHONE_BREAKPOINT}px) {
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .outer { padding-left: 12px !important; padding-right: 12px !important; }
    .h1 { font-size: 22px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .d-field { background: ${DARK.field} !important; }
    .d-paper { background: ${DARK.paper} !important; }
    .d-ink { color: ${DARK.ink} !important; }
    .d-t2 { color: ${DARK.text2} !important; }
    .d-t3 { color: ${DARK.text3} !important; }
    .d-hair { border-color: ${DARK.hair} !important; }
    .d-panel { border-color: ${DARK.panel} !important; }
    .d-btn { background: ${DARK.btnBg} !important; }
    .d-btn a { color: ${DARK.btnText} !important; }
    .l-img { display: none !important; }
    .d-img { display: block !important; max-height: none !important; overflow: visible !important; }
  }
  [data-ogsc] .d-ink { color: ${DARK.ink} !important; }
  [data-ogsc] .d-t2 { color: ${DARK.text2} !important; }
  [data-ogsc] .d-t3 { color: ${DARK.text3} !important; }
</style>
</head>`;
}

const preheader = (text: string) =>
  `<div style="${DISPLAY_NONE}font-size:1px;line-height:1px;color:transparent;opacity:0;">${escapeHtml(text)}${PREHEADER_PAD}</div>`;

/** A light image plus a dark twin that only dark-mode-aware clients show. */
function image(base: string, name: string, size: { w: number; h: number }, alt: string): string {
  const tag = (file: string, cls?: string) =>
    `<img ${cls ? `class="${cls}" ` : ""}src="${escapeHtml(`${base}${IMAGE_PATH}/${file}.png`)}" width="${size.w}" height="${size.h}" alt="${escapeHtml(alt)}" style="display:block;width:${size.w}px;height:${size.h}px;border:0;">`;
  return `${tag(name, "l-img")}<!--[if !mso]><!--><div class="d-img" style="${DISPLAY_NONE}">${tag(`${name}-dark`)}</div><!--<![endif]-->`;
}

const paragraph = (html: string) =>
  `<p class="d-ink" style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:1.5;color:${LIGHT.ink};">${html}</p>`;

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="d-btn" bgcolor="${LIGHT.ink}" style="background:${LIGHT.ink};">
<a href="${escapeHtml(url)}" style="display:inline-block;padding:16px 24px;font-family:${MONO};font-size:14px;line-height:16px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

const writtenLink = (url: string) =>
  `<p class="d-t2" style="margin:20px 0 0 0;font-family:${SANS};font-size:14px;line-height:1.5;color:${LIGHT.text2};">If the button does not work, open this link:<br>
<a href="${escapeHtml(url)}" class="d-t2" style="color:${LIGHT.text2};text-decoration:underline;${WRAP_LINK}">${escapeHtml(url)}</a></p>`;

const footerStyle = `margin:0 0 4px 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${LIGHT.text3};`;

export function renderHtml(e: EmailContent): string {
  const base = e.appUrl.replace(/\/$/, "");
  return `${head(e.subject)}
<body class="d-field" style="margin:0;padding:0;background:${LIGHT.field};">
${preheader(e.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="d-field" bgcolor="${LIGHT.field}" style="background:${LIGHT.field};">
<tr><td align="center" class="outer" style="padding:32px 16px 40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${MAX_WIDTH}px;">
<tr><td style="padding:0 0 20px 0;">${image(base, "logo", { w: LOGO_SIZE, h: LOGO_SIZE }, "noma")}</td></tr>
<tr><td class="d-paper d-panel px" bgcolor="${LIGHT.paper}" style="background:${LIGHT.paper};border:1.5px solid ${LIGHT.panel};padding:40px 40px 36px 40px;">
${image(base, e.art, { w: ART_WIDTH, h: ART_HEIGHT }, "")}
<div style="height:24px;line-height:24px;font-size:24px;">&nbsp;</div>
<h1 class="h1 d-ink" style="margin:0 0 16px 0;font-family:${SANS};font-size:24px;line-height:1.25;font-weight:600;color:${LIGHT.ink};">${escapeHtml(e.heading)}</h1>
${e.body.map((p) => paragraph(inline(p))).join("")}
<div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>${button(e.action.label, e.action.url)}${writtenLink(e.action.url)}
<p class="d-t2" style="margin:12px 0 16px 0;font-family:${SANS};font-size:14px;line-height:1.5;color:${LIGHT.text2};">${escapeHtml(e.note)}</p>
<div class="d-hair" style="border-top:1px solid ${LIGHT.hair};margin:24px 0 16px 0;font-size:0;line-height:0;">&nbsp;</div>
<p class="d-t3" style="margin:0;font-family:${SANS};font-size:14px;line-height:1.5;color:${LIGHT.text3};">${escapeHtml(e.small)}</p>
</td></tr>
<tr><td style="padding:24px 0 0 0;">
<p class="d-t3" style="${footerStyle}">Sent to ${escapeHtml(e.to)} ${escapeHtml(e.reason)}</p>
<p class="d-t3" style="${footerStyle}margin-bottom:0;">Questions? Reply to this email.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
