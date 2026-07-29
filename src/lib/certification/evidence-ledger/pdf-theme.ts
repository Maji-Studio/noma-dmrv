/**
 * Shared visual theme for the evidence-ledger PDFs.
 *
 * Single source of the design tokens (mirroring docs/design-system.md), the
 * DM Sans / DM Mono families, the no-JSX element helpers, and the document
 * chrome every ledger shares: page frame, masthead, claim-band frame, section
 * heads, table frame, apparatus, and footer. Table BODY styles stay in each
 * document — column shapes are content-specific — but the chrome lives here so
 * sibling ledgers cannot drift apart.
 *
 * Documents consume it as `const styles = { ...theme, ...StyleSheet.create({…}) }`.
 * A deliberate divergence overrides the theme entry in the local block by
 * spreading it (`{ ...theme.thText, fontSize: 6.5 }`) so the delta stays
 * visible at the definition site.
 */
import {
  createElement as h,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { registerEvidenceLedgerFonts } from "./fonts";

// ── Tokens ───────────────────────────────────────────────────────────────────
/**
 * EVERY token must be a 6-digit hex string — never `rgba()`, never 8-digit hex.
 *
 * @react-pdf/stylesheet folds an `rgba()` value into 8-digit hex (`#RRGGBBAA`),
 * but @react-pdf/pdfkit's `_normalizeColor` only understands 3- and 6-digit
 * hex: it parses all eight digits as one integer and shifts, so
 * `rgba(15,2,26,0.12)` arrives as red 3842, which clamps to full red. Text fill
 * and `backgroundColor` survive because @react-pdf/render splits those into
 * colour + opacity, but border strokes go straight to `ctx.strokeColor(…)` —
 * which is why translucent tokens used to paint every rule and table frame red.
 *
 * The tints below are therefore pre-flattened over `paper`
 * (`round(channel × a + 255 × (1 − a))`), which is exactly the design system's
 * two-greys rule — every grey is an alpha of ink or plum over paper — resolved
 * ahead of time instead of at paint time. On the handful of hairlines that sit
 * on the `sea` wash rather than bare paper the composite differs by under 1%
 * luminance, far below a 1pt rule's visible threshold.
 */
export const C = {
  ink: "#0f021a",
  ink70: "#574e5f", // ink @ 70% over paper
  ink55: "#7b7481", // ink @ 55% over paper
  ink40: "#9f9aa3", // ink @ 40% over paper
  ink25: "#c3c0c6", // ink @ 25% over paper
  ink12: "#e2e1e4", // ink @ 12% over paper
  paper: "#ffffff",
  plum: "#480b73",
  plumSoft: "#ad91c0", // plum @ 45% over paper
  sea: "#f6f3f8", // plum @ 5% over paper
  sea2: "#efe9f2", // plum @ 9% over paper
  pink: "#a6216e",
  burnt: "#bc4519",
  amber: "#8a5a00",
  green: "#17744a",
  greenLite: "#7fd3a9",
} as const;

export const SANS = "DM Sans";
export const MONO = "DM Mono";

// ── Element helpers ──────────────────────────────────────────────────────────
export type Style =
  | Record<string, unknown>
  | Array<Record<string, unknown> | false | undefined>;
// react-pdf strictly types each component's `style` (and createElement's SVG
// overloads otherwise misfire on our generic props). These no-JSX helpers pass
// structurally-equivalent style objects, so route them through permissive
// component aliases instead of widening every caller.
const View_ = View as ComponentType<Record<string, unknown>>;
export const Text_ = Text as ComponentType<Record<string, unknown>>;
export const v = (
  style: Style,
  props: Record<string, unknown>,
  ...kids: ReactNode[]
): ReactElement => h(View_, { style, ...props }, ...kids);
export const t = (style: Style, text: ReactNode): ReactElement =>
  h(Text_, { style }, text);

// ── Shared chrome ────────────────────────────────────────────────────────────
export const theme = StyleSheet.create({
  page: {
    backgroundColor: C.paper,
    color: C.ink,
    fontFamily: SANS,
    fontSize: 9,
    paddingTop: 34,
    paddingBottom: 46,
    paddingHorizontal: 34,
  },

  // Masthead
  masthead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 9,
    borderBottomWidth: 1.5,
    borderBottomColor: C.ink,
  },
  wordmarkRow: { flexDirection: "row", alignItems: "baseline" },
  wordmark: { fontFamily: SANS, fontWeight: 700, fontSize: 16, letterSpacing: -0.3 },
  wordmarkSub: {
    fontFamily: MONO,
    fontSize: 7.5,
    color: C.ink55,
    letterSpacing: 1,
    marginLeft: 7,
  },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 8,
    color: C.plum,
    letterSpacing: 1.3,
    marginTop: 11,
  },
  title: { fontFamily: SANS, fontWeight: 600, fontSize: 21, lineHeight: 1.08, marginTop: 7 },

  metaCol: { alignItems: "flex-end", maxWidth: 210 },
  metaPair: { alignItems: "flex-end", marginBottom: 6 },
  metaLabel: {
    fontFamily: MONO,
    fontSize: 7,
    color: C.ink40,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  metaVal: { fontFamily: MONO, fontSize: 9, color: C.ink, marginTop: 1 },

  // Claim band frame (each document supplies its own band body)
  claim: { marginTop: 14, borderWidth: 1.5, borderColor: C.ink },
  claimHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C.sea,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.ink12,
  },
  claimHeadLabel: {
    fontFamily: MONO,
    fontSize: 8,
    color: C.ink70,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  claimHeadEq: { fontFamily: MONO, fontSize: 8, color: C.ink55 },

  // Section head
  section: { marginTop: 13 },
  sectionHead: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  rule: { width: 4, height: 13, marginRight: 8 },
  sectionName: { fontFamily: SANS, fontWeight: 600, fontSize: 11 },
  sectionTag: {
    fontFamily: MONO,
    fontSize: 7.5,
    color: C.ink40,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginLeft: 8,
  },
  sectionEqn: { fontFamily: MONO, fontSize: 7.5, color: C.ink40, marginLeft: "auto" },

  // Table frame
  table: { borderWidth: 1.5, borderColor: C.ink25 },
  th: {
    flexDirection: "row",
    backgroundColor: C.sea,
    borderBottomWidth: 1,
    borderBottomColor: C.ink12,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  thText: {
    fontFamily: MONO,
    fontSize: 7,
    color: C.ink55,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.ink12,
    paddingVertical: 6,
    paddingHorizontal: 7,
  },
  trLast: { borderBottomWidth: 0 },
  qty: { fontFamily: MONO, fontSize: 9, textAlign: "right" },
  tfoot: {
    flexDirection: "row",
    backgroundColor: C.sea2,
    borderTopWidth: 1.5,
    borderTopColor: C.ink25,
    paddingVertical: 6,
    paddingHorizontal: 7,
    alignItems: "flex-end",
  },

  // Apparatus
  apparatus: {
    marginTop: 18,
    paddingTop: 11,
    borderTopWidth: 1.5,
    borderTopColor: C.ink,
    flexDirection: "row",
  },
  noteCol: { flex: 1.55, paddingRight: 16 },
  legendCol: { flex: 1 },
  noteH: {
    fontFamily: MONO,
    fontSize: 7.5,
    color: C.ink55,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  noteBody: { fontFamily: SANS, fontSize: 8, color: C.ink70, lineHeight: 1.5 },
  legendRow: { flexDirection: "row", marginBottom: 3 },
  // Width is content-shaped: each document sets it beside its longest key.
  legendKey: { fontFamily: MONO, fontSize: 7, color: C.ink40, textTransform: "uppercase" },
  legendDesc: { fontFamily: MONO, fontSize: 7, color: C.ink70, flex: 1 },

  // Footer
  footer: {
    position: "absolute",
    bottom: 22,
    left: 34,
    right: 34,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontFamily: MONO, fontSize: 7, color: C.ink40, letterSpacing: 0.5 },
});

/** Register the bundled fonts, then render a ledger Document to a PDF buffer. */
export async function renderLedgerToBuffer(doc: ReactElement): Promise<Buffer> {
  registerEvidenceLedgerFonts();
  return renderToBuffer(doc as Parameters<typeof renderToBuffer>[0]);
}
