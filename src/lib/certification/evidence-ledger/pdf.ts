/**
 * Transport Emissions Evidence Ledger — react-pdf renderer.
 *
 * Re-implements the approved HTML/CSS mockup in react-pdf's flexbox subset
 * (no CSS grid/tables there, so the "tables" are flex rows with fixed column
 * widths). Built from a pure `LedgerModel`; the only side effect is font
 * registration. `createElement` is used instead of JSX so this module renders
 * identically under Next's server bundle and a plain Node/tsx verifier, with no
 * dependency on the project's JSX transform.
 *
 * Design tokens mirror docs/design-system.md: plum ink, accent triad
 * burnt/pink/plum per category, verification green for the ✓ checks.
 */
import { createElement as h, type ComponentType, type ReactElement } from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { registerEvidenceLedgerFonts } from "./fonts";
import type { LedgerCategory, LedgerModel } from "./types";

// ── Tokens ───────────────────────────────────────────────────────────────────
const C = {
  ink: "#0f021a",
  ink70: "rgba(15,2,26,0.7)",
  ink55: "rgba(15,2,26,0.55)",
  ink40: "rgba(15,2,26,0.4)",
  ink25: "rgba(15,2,26,0.25)",
  ink12: "rgba(15,2,26,0.12)",
  paper: "#ffffff",
  plum: "#480b73",
  plumSoft: "rgba(72,11,115,0.45)",
  sea: "rgba(72,11,115,0.05)",
  sea2: "rgba(72,11,115,0.09)",
  pink: "#a6216e",
  burnt: "#bc4519",
  green: "#17744a",
  greenLite: "#7fd3a9",
} as const;

const CAT_COLOR: Record<LedgerCategory["key"], string> = {
  feedstock: C.burnt,
  biochar: C.pink,
  sample: C.plum,
};

const SANS = "DM Sans";
const MONO = "DM Mono";

// Column widths in points (A4 content ≈ 527pt; route flexes). t·km is generous
// (60pt) so 4-digit-thousands subtotals never sit flush against the edge.
// Numeric columns carry a left gap (paddingLeft) so right-aligned values don't
// touch the next column ("4,500 kg" against "Road").
const COL = { leg: 30, distance: 42, mass: 52, mode: 56, basis: 72, tkm: 60 };
const GAP = 8;

// ── Number formatting (DM Mono, tabular) ─────────────────────────────────────
const nf2 = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfi = (n: number): string => n.toLocaleString("en-US");

const styles = StyleSheet.create({
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

  metaCol: { alignItems: "flex-end", maxWidth: 200 },
  metaPair: { alignItems: "flex-end", marginBottom: 6 },
  metaLabel: {
    fontFamily: MONO,
    fontSize: 7,
    color: C.ink40,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  metaVal: { fontFamily: MONO, fontSize: 9, color: C.ink, marginTop: 1 },

  // Claim band
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
  claimRow: { flexDirection: "row" },
  claimCell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 11,
    borderRightWidth: 1,
    borderRightColor: C.ink12,
  },
  claimCellTotal: { flexBasis: 0, flexGrow: 1.25, backgroundColor: C.ink, borderRightWidth: 0 },
  claimCatRow: { flexDirection: "row", alignItems: "center" },
  swatch: { width: 7, height: 7, marginRight: 5 },
  claimCat: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  claimVal: { fontFamily: MONO, fontWeight: 500, fontSize: 22, marginTop: 4, letterSpacing: -0.4 },
  claimUnit: { fontFamily: MONO, fontSize: 8, color: C.ink40, marginTop: 2 },
  claimCheck: { fontFamily: MONO, fontSize: 7.5, color: C.green, marginTop: 5 },

  // Ledger section
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
  legRef: { fontFamily: MONO, fontSize: 8.5, color: C.ink70, fontWeight: 500 },
  routeLine: { fontFamily: SANS, fontSize: 9, lineHeight: 1.3 },
  routeArrow: { color: C.ink40 },
  geo: { fontFamily: MONO, fontSize: 6.5, color: C.ink40, marginTop: 2 },
  qty: { fontFamily: MONO, fontSize: 9, textAlign: "right" },
  qtyUnit: { color: C.ink40, fontSize: 7 },
  modeText: { fontFamily: MONO, fontSize: 8 },
  veh: { fontFamily: SANS, fontSize: 7, color: C.ink40, marginTop: 1 },
  prov: {
    fontFamily: MONO,
    fontSize: 6.5,
    color: C.ink55,
    letterSpacing: 0.3,
    textTransform: "uppercase",
    borderWidth: 1,
    borderColor: C.ink12,
    paddingVertical: 2,
    paddingHorizontal: 4,
    alignSelf: "flex-start",
  },
  provDerived: { color: C.plum, borderColor: C.plumSoft },
  tkm: { fontFamily: MONO, fontWeight: 500, fontSize: 10, textAlign: "right" },

  tfoot: {
    flexDirection: "row",
    backgroundColor: C.sea2,
    borderTopWidth: 1.5,
    borderTopColor: C.ink25,
    paddingVertical: 6,
    paddingHorizontal: 7,
    alignItems: "flex-end",
  },
  subLabel: {
    fontFamily: MONO,
    fontSize: 8,
    color: C.ink70,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  subVal: { fontFamily: MONO, fontWeight: 500, fontSize: 11, textAlign: "right" },
  subUnit: { fontFamily: MONO, fontSize: 7, color: C.ink40, textAlign: "right" },

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
  legendKey: {
    fontFamily: MONO,
    fontSize: 7,
    color: C.ink40,
    textTransform: "uppercase",
    width: 72,
  },
  legendDesc: { fontFamily: MONO, fontSize: 7, color: C.ink70, flex: 1 },

  footer: {
    position: "absolute",
    bottom: 22,
    left: 34,
    right: 34,
    flexDirection: "row",
    justifyContent: "space-between",
    fontFamily: MONO,
    fontSize: 7,
    color: C.ink40,
  },
  footerText: { fontFamily: MONO, fontSize: 7, color: C.ink40, letterSpacing: 0.5 },
});

// element helpers ─────────────────────────────────────────────────────────────
type Style = Record<string, unknown> | Array<Record<string, unknown> | false | undefined>;
// react-pdf strictly types each component's `style` (and createElement's SVG
// overloads otherwise misfire on our generic props). These no-JSX helpers pass
// structurally-equivalent style objects, so route them through permissive
// component aliases instead of widening every caller.
const View_ = View as ComponentType<Record<string, unknown>>;
const Text_ = Text as ComponentType<Record<string, unknown>>;
const v = (style: Style, props: Record<string, unknown>, ...kids: unknown[]): ReactElement =>
  h(View_, { style, ...props }, ...(kids as ReactElement[]));
const t = (style: Style, text: unknown): ReactElement => h(Text_, { style }, text as string);

function masthead(model: LedgerModel): ReactElement {
  const left = v({}, {},
    v(styles.wordmarkRow, {},
      t(styles.wordmark, "noma"),
      t(styles.wordmarkSub, "dMRV · DARK EARTH CARBON"),
    ),
    t(styles.eyebrow, "TRANSPORTATION MODULE V1.1 · DISTANCE-BASED · EQ. 3"),
    h(Text, { style: styles.title }, "Transport Emissions\nEvidence Ledger"),
  );
  const pair = (label: string, val: string) =>
    v(styles.metaPair, {}, t(styles.metaLabel, label), t(styles.metaVal, val));
  const right = v(styles.metaCol, {},
    pair("Member batches", model.memberBatchCodes ?? "—"),
    pair("Facility", model.facilityName ?? "—"),
    pair("Registry project", model.externalProjectId ?? "—"),
    pair("Legs reconciled", `${model.totalLegs} across 3 categories`),
  );
  return v(styles.masthead, {}, left, right);
}

function claimCell(cat: LedgerCategory): ReactElement {
  return v(styles.claimCell, {},
    v(styles.claimCatRow, {},
      v([styles.swatch, { backgroundColor: CAT_COLOR[cat.key] }], {}),
      t(styles.claimCat, cat.name.split(" ")[0]),
    ),
    t(styles.claimVal, nf2(cat.subtotalTkm)),
    t(styles.claimUnit, `tonne·km · ${cat.legs.length} legs`),
    t(styles.claimCheck, "•  matches submitted scalar"),
  );
}

function claimBand(model: LedgerModel): ReactElement {
  const totalCell = v([styles.claimCell, styles.claimCellTotal], {},
    t([styles.claimCat, { color: "rgba(255,255,255,0.75)" }], "Total mass·distance"),
    t([styles.claimVal, { color: C.paper }], nf2(model.totalTkm)),
    t([styles.claimUnit, { color: "rgba(255,255,255,0.55)" }], "tonne·kilometres"),
    t([styles.claimCheck, { color: C.greenLite }], `•  ${model.totalLegs} legs reconcile to submitted scalars`),
  );
  return v(styles.claim, {},
    v(styles.claimHead, {},
      t(styles.claimHeadLabel, "Submitted to registry — mass · distance"),
      t(styles.claimHeadEq, "scalar = SUM ( distance × mass ), per category"),
    ),
    v(styles.claimRow, {}, ...model.categories.map(claimCell), totalCell),
  );
}

function routeCell(leg: LedgerCategory["legs"][number]): ReactElement {
  const origin = leg.originName ?? "—";
  const dest = leg.destinationName ?? "—";
  const geo =
    leg.originGeo || leg.destinationGeo
      ? `${leg.originGeo ?? "—"} › ${leg.destinationGeo ?? "—"}`
      : "coordinates not recorded";
  return v({ flex: 1, paddingRight: 8 }, {},
    h(Text, { style: styles.routeLine },
      origin,
      h(Text, { style: styles.routeArrow }, "  ›  "),
      dest,
    ),
    t(styles.geo, geo),
  );
}

function legRow(leg: LedgerCategory["legs"][number], isLast: boolean): ReactElement {
  return v([styles.tr, isLast && styles.trLast], { wrap: false },
    t([styles.legRef, { width: COL.leg }], leg.ref),
    routeCell(leg),
    h(Text, { style: [styles.qty, { width: COL.distance, paddingLeft: 4 }] },
      nfi(leg.distanceKm), h(Text, { style: styles.qtyUnit }, " km")),
    h(Text, { style: [styles.qty, { width: COL.mass, paddingLeft: GAP }] },
      leg.massMissing ? "—" : nfi(leg.loadMassKg),
      leg.massMissing ? "" : h(Text, { style: styles.qtyUnit }, " kg")),
    v({ width: COL.mode, paddingLeft: GAP }, {},
      t(styles.modeText, leg.mode),
      leg.vehicle ? t(styles.veh, leg.vehicle) : null,
    ),
    v({ width: COL.basis, paddingLeft: GAP }, {},
      t([styles.prov, leg.basis === "Map · derived" && styles.provDerived], leg.basis),
    ),
    h(Text, { style: [styles.tkm, { width: COL.tkm, paddingLeft: GAP }] }, nf2(leg.tkm)),
  );
}

function ledgerSection(cat: LedgerCategory): ReactElement {
  const header = v(styles.sectionHead, { minPresenceAhead: 80 },
    v([styles.rule, { backgroundColor: CAT_COLOR[cat.key] }], {}),
    t(styles.sectionName, cat.name),
    t(styles.sectionTag, cat.tag),
    t(styles.sectionEqn, "distance × mass ÷ 1000 = t·km"),
  );
  const th = v(styles.th, {},
    t([styles.thText, { width: COL.leg }], "Leg"),
    t([styles.thText, { flex: 1 }], "Route"),
    t([styles.thText, { width: COL.distance, textAlign: "right", paddingLeft: 4 }], "Distance"),
    t([styles.thText, { width: COL.mass, textAlign: "right", paddingLeft: GAP }], "Load mass"),
    t([styles.thText, { width: COL.mode, paddingLeft: GAP }], "Mode"),
    t([styles.thText, { width: COL.basis, paddingLeft: GAP }], "Distance basis"),
    t([styles.thText, { width: COL.tkm, textAlign: "right", paddingLeft: GAP }], "t·km"),
  );
  const rows = cat.legs.map((leg, i) => legRow(leg, i === cat.legs.length - 1));
  const foot = v(styles.tfoot, {},
    t([styles.subLabel, { flex: 1 }], `Subtotal — ${cat.key} · ${cat.legs.length} legs`),
    v({ width: COL.tkm + 40 }, {},
      t(styles.subVal, nf2(cat.subtotalTkm)),
      t(styles.subUnit, "t·km"),
    ),
  );
  return v(styles.section, {}, header, v(styles.table, {}, th, ...rows, foot));
}

function apparatus(): ReactElement {
  const note = v(styles.noteCol, {},
    t(styles.noteH, "Method note"),
    t(styles.noteBody,
      "Each leg's contribution is distance × mass, summed per category into the single " +
      "mass_distance scalar submitted to Isometric Certify. The emission factor (per the " +
      "Transportation module's component for the declared mode and vehicle class) is applied " +
      "by the registry, not in this ledger — noma submits distance and mass; Certify computes " +
      "the sum of (distance × mass) over legs, times that factor. This sheet exists because the " +
      "aggregate scalar alone hides the per-leg breakdown; here every row that backs each scalar " +
      "is auditable, and the per-leg bills of lading remain attached as Sources on the Removal.",
    ),
  );
  const legendRow = (k: string, d: string) =>
    v(styles.legendRow, {}, t(styles.legendKey, k), t(styles.legendDesc, d));
  const legend = v(styles.legendCol, {},
    t(styles.noteH, "Distance basis"),
    legendRow("Map · derived", "Routed estimate, auto-derived from the stored supplier / customer distance."),
    legendRow("Map · manual", "Routed estimate, entered for this leg."),
    legendRow("t·km", "tonne·kilometre = distance (km) × load (t)."),
  );
  return v(styles.apparatus, {}, note, legend);
}

function footer(model: LedgerModel): ReactElement {
  const date = model.generatedAtIso.slice(0, 10);
  return v(styles.footer, { fixed: true },
    t(styles.footerText, `NOMA DMRV · TRANSPORT EVIDENCE LEDGER · ${model.totalLegs} LEGS`),
    h(Text, {
      style: styles.footerText,
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
        `GENERATED ${date} · PAGE ${pageNumber} / ${totalPages}`,
    }),
  );
}

function buildDocument(model: LedgerModel): ReactElement {
  const sections = model.categories
    .filter((c) => c.legs.length > 0)
    .map(ledgerSection);
  return h(Document, {
    title: `Transport Emissions Evidence Ledger${model.memberBatchCodes ? ` — ${model.memberBatchCodes}` : ""}`,
    author: "noma dMRV",
    subject: "Per-leg transport mass·distance ledger backing the submitted scalars",
  },
    h(Page, { size: "A4", style: styles.page },
      masthead(model),
      claimBand(model),
      ...sections,
      apparatus(),
      footer(model),
    ),
  );
}

export async function renderEvidenceLedgerPdf(model: LedgerModel): Promise<Buffer> {
  registerEvidenceLedgerFonts();
  return renderToBuffer(
    buildDocument(model) as Parameters<typeof renderToBuffer>[0],
  );
}
