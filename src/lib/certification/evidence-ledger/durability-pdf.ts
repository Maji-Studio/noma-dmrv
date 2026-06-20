/**
 * 200-Year Durability Evidence Ledger — react-pdf renderer.
 *
 * Sibling to the transport ledger (`pdf.ts`): same visual language (DM Sans /
 * DM Mono, plum ink, verification green, brutalist square corners, no
 * border-radius), built from a pure `DurabilityLedgerModel`. `createElement`
 * (no JSX) so this renders identically under Next's server bundle and a plain
 * Node/tsx verifier.
 *
 * The document's hero is the protocol eligibility gate written literally — molar
 * H/C_org < 0.5 AND O/C_org < 0.2, judged on each batch's pooled replicate mean.
 * Below it, per credit batch, the raw ≥3 lab replicates reduce into the submitted
 * mean ± std-dev (an accounting-style subtotal), so "raw → submitted" is auditable
 * at a glance. A facility soil-temperature reference block closes the working.
 *
 * Glyph note: the bundled DM Sans/Mono TTFs carry a Latin subset only — `→`,
 * `≥`, `✓`, `✗` render as .notdef. Pass/fail is therefore carried by COLOUR
 * (green / burnt) plus a coloured swatch View and a word ("ELIGIBLE"), never a
 * tick glyph; the threshold rule is always stated as `< 0.50` and the measured
 * mean is tinted to show whether it satisfies it.
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
import type {
  DurabilityLedgerModel,
  LedgerBatch,
  LedgerStat,
} from "./durability-types";

// ── Tokens (shared with the transport ledger) ────────────────────────────────
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
  burntSoft: "rgba(188,69,25,0.5)",
  amber: "#8a5a00",
  green: "#17744a",
  greenLite: "#7fd3a9",
} as const;

const SANS = "DM Sans";
const MONO = "DM Mono";

// Replicate-table column widths (points). Sample column flexes; the rest are
// fixed so the per-replicate values align under the submitted mean ± s.d. row.
const COL = { ref: 20, day: 44, hc: 46, oc: 46, totc: 42, orgc: 42, inorg: 46 };
const GAP = 6;

// ── Number formatting (DM Mono, tabular) ─────────────────────────────────────
const nf3 = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf1 = (n: number): string =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfi = (n: number): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

// "mean ± s.d." for a column, at the given precision; mean alone when s.d. null.
function stat(value: LedgerStat | null, fmt: (n: number) => string): string {
  if (value == null) return "—";
  return value.stdDev == null
    ? fmt(value.mean)
    : `${fmt(value.mean)} ± ${fmt(value.stdDev)}`;
}

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
  eyebrow: { fontFamily: MONO, fontSize: 8, color: C.plum, letterSpacing: 1.1, marginTop: 11 },
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

  // Eligibility verdict band (the hero / claim)
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
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  claimHeadEq: { fontFamily: MONO, fontSize: 8, color: C.ink55 },

  verdictColHead: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.ink12,
  },
  verdictColLabel: {
    fontFamily: MONO,
    fontSize: 6.5,
    color: C.ink40,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  verdictRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.ink12,
  },
  verdictBatch: { fontFamily: MONO, fontWeight: 500, fontSize: 11, color: C.ink },
  ratioVal: { fontFamily: MONO, fontWeight: 500, fontSize: 13, letterSpacing: -0.2 },
  ratioRule: { fontFamily: MONO, fontSize: 8, color: C.ink40, marginTop: 2 },
  verdictTag: { flexDirection: "row", alignItems: "center" },
  verdictSwatch: { width: 8, height: 8, marginRight: 6 },
  verdictWord: { fontFamily: MONO, fontWeight: 500, fontSize: 9, letterSpacing: 0.6, textTransform: "uppercase" },

  claimFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: C.ink,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  claimFootText: { fontFamily: MONO, fontSize: 8, color: C.paper, letterSpacing: 0.5 },
  claimFootSub: { fontFamily: MONO, fontSize: 8, color: "rgba(255,255,255,0.6)" },

  // Per-batch reconciliation section
  section: { marginTop: 13 },
  sectionHead: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  rule: { width: 4, height: 13, marginRight: 8, backgroundColor: C.plum },
  sectionName: { fontFamily: SANS, fontWeight: 600, fontSize: 11 },
  sectionTag: {
    fontFamily: MONO,
    fontSize: 7.5,
    color: C.ink40,
    letterSpacing: 0.6,
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
    fontSize: 6.5,
    color: C.ink55,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.ink12,
    paddingVertical: 6,
    paddingHorizontal: 7,
    alignItems: "flex-start",
  },
  repRef: { fontFamily: MONO, fontSize: 8.5, color: C.ink70, fontWeight: 500 },
  repCode: { fontFamily: SANS, fontSize: 9 },
  repLab: { fontFamily: SANS, fontSize: 6.5, color: C.ink40, marginTop: 1 },
  day: { fontFamily: MONO, fontSize: 8, color: C.ink55 },
  qty: { fontFamily: MONO, fontSize: 9, textAlign: "right" },
  qtyDerived: { color: C.plum },
  qtyMissing: { color: C.ink25 },

  tfoot: {
    flexDirection: "row",
    backgroundColor: C.sea2,
    borderTopWidth: 1.5,
    borderTopColor: C.ink25,
    paddingVertical: 7,
    paddingHorizontal: 7,
    alignItems: "flex-start",
  },
  subLabel: { fontFamily: MONO, fontSize: 7.5, color: C.ink70, letterSpacing: 0.6, textTransform: "uppercase" },
  subN: { fontFamily: MONO, fontSize: 6.5, color: C.ink40, marginTop: 1 },
  subVal: { fontFamily: MONO, fontWeight: 500, fontSize: 8.5, textAlign: "right" },

  // Soil reference block
  soil: { marginTop: 14, borderWidth: 1.5, borderColor: C.ink25 },
  soilHead: {
    backgroundColor: C.sea,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.ink12,
  },
  soilHeadText: { fontFamily: MONO, fontSize: 8, color: C.ink70, letterSpacing: 1.1, textTransform: "uppercase" },
  soilBody: { flexDirection: "row" },
  soilCell: { flex: 1, paddingVertical: 11, paddingHorizontal: 12, borderRightWidth: 1, borderRightColor: C.ink12 },
  soilCellLast: { borderRightWidth: 0, flexGrow: 1.3 },
  soilLabel: { fontFamily: MONO, fontSize: 7, color: C.ink40, letterSpacing: 0.7, textTransform: "uppercase" },
  soilBig: { fontFamily: MONO, fontWeight: 500, fontSize: 22, marginTop: 3, letterSpacing: -0.4 },
  soilUnit: { fontFamily: MONO, fontSize: 8, color: C.ink40 },
  soilLine: { fontFamily: MONO, fontSize: 8, color: C.ink70, marginTop: 3 },
  soilNote: { fontFamily: SANS, fontSize: 8, color: C.ink70, lineHeight: 1.45, marginTop: 3 },

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
  noteH: { fontFamily: MONO, fontSize: 7.5, color: C.ink55, letterSpacing: 1.1, textTransform: "uppercase", marginBottom: 4 },
  noteBody: { fontFamily: SANS, fontSize: 8, color: C.ink70, lineHeight: 1.5 },
  legendRow: { flexDirection: "row", marginBottom: 3 },
  legendKey: { fontFamily: MONO, fontSize: 7, color: C.ink40, textTransform: "uppercase", width: 88 },
  legendDesc: { fontFamily: MONO, fontSize: 7, color: C.ink70, flex: 1 },

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

// element helpers ─────────────────────────────────────────────────────────────
type Style = Record<string, unknown> | Array<Record<string, unknown> | false | undefined>;
const View_ = View as ComponentType<Record<string, unknown>>;
const Text_ = Text as ComponentType<Record<string, unknown>>;
const v = (style: Style, props: Record<string, unknown>, ...kids: unknown[]): ReactElement =>
  h(View_, { style, ...props }, ...(kids as ReactElement[]));
const t = (style: Style, text: unknown): ReactElement => h(Text_, { style }, text as string);

// Verdict colour from the eligibility state: green pass, burnt fail, amber
// indeterminate (an indeterminate batch is gate-blocked before submission; the
// renderer stays honest if one is ever generated for inspection).
function verdict(eligible: boolean | null): {
  color: string;
  word: string;
} {
  if (eligible === true) return { color: C.green, word: "Eligible" };
  if (eligible === false) return { color: C.burnt, word: "Ineligible" };
  return { color: C.amber, word: "Indeterminate" };
}

function masthead(model: DurabilityLedgerModel): ReactElement {
  const left = v({}, {},
    v(styles.wordmarkRow, {},
      t(styles.wordmark, "noma"),
      t(styles.wordmarkSub, "dMRV · DARK EARTH CARBON"),
    ),
    t(styles.eyebrow, "BIOCHAR IN SOIL · MODULE 1.2 · §3 T2 · §8.3.1"),
    h(Text, { style: styles.title }, "200-Year Durability\nEvidence Ledger"),
  );
  const pair = (label: string, val: string) =>
    v(styles.metaPair, {}, t(styles.metaLabel, label), t(styles.metaVal, val));
  const right = v(styles.metaCol, {},
    pair("Member batches", model.memberBatchCodes ?? "—"),
    pair("Facility", model.facilityName ?? "—"),
    pair("Registry project", model.externalProjectId ?? "—"),
    pair("Batches reconciled", `${model.batches.length} · ${model.totalReplicates} replicates`),
  );
  return v(styles.masthead, {}, left, right);
}

// One ratio cell in the verdict band: the measured mean (tinted by whether it
// satisfies the ceiling) above the always-stated `< ceiling` rule.
function ratioCell(
  width: number,
  mean: number | null,
  within: boolean | null,
  ceiling: string,
): ReactElement {
  const color = within === true ? C.green : within === false ? C.burnt : C.amber;
  return v({ width }, {},
    t([styles.ratioVal, { color }], mean == null ? "—" : nf3(mean)),
    t(styles.ratioRule, `< ${ceiling}`),
  );
}

function verdictRow(batch: LedgerBatch, isLast: boolean): ReactElement {
  const { color, word } = verdict(batch.eligibility.eligible);
  const e = batch.eligibility;
  return v([styles.verdictRow, isLast && { borderBottomWidth: 0 }], { wrap: false },
    t([styles.verdictBatch, { flex: 1 }], batch.creditBatchCode),
    ratioCell(150, e.hToCorgMean, e.hToCWithinThreshold, "0.50"),
    ratioCell(150, e.oToCorgMean, e.oToCWithinThreshold, "0.20"),
    v([styles.verdictTag, { width: 110 }], {},
      v([styles.verdictSwatch, { backgroundColor: color }], {}),
      t([styles.verdictWord, { color }], word),
    ),
  );
}

function eligibilityBand(model: DurabilityLedgerModel): ReactElement {
  const head = v(styles.claimHead, {},
    t(styles.claimHeadLabel, "Submitted to registry — durability eligibility"),
    t(styles.claimHeadEq, "judged on the pooled replicate mean · §3 Table 2"),
  );
  const colHead = v(styles.verdictColHead, {},
    t([styles.verdictColLabel, { flex: 1 }], "Credit batch"),
    t([styles.verdictColLabel, { width: 150 }], "H/C_org (molar)"),
    t([styles.verdictColLabel, { width: 150 }], "O/C_org (molar)"),
    t([styles.verdictColLabel, { width: 110 }], "Permanence verdict"),
  );
  const rows = model.batches.map((b, i) =>
    verdictRow(b, i === model.batches.length - 1),
  );
  const allEligible = model.eligibleBatchCount === model.batches.length;
  const foot = v(styles.claimFoot, {},
    t(styles.claimFootText,
      `${model.eligibleBatchCount} / ${model.batches.length} batches eligible`),
    t(styles.claimFootSub,
      allEligible
        ? `all clear H/C_org < 0.5 AND O/C_org < 0.2`
        : `review the flagged batch(es) before submission`),
  );
  return v(styles.claim, {}, head, colHead, ...rows, foot);
}

// One right-aligned numeric replicate cell; "—" tinted faint when the value is
// missing, plum when the inorganic figure was Eq.2-derived rather than measured.
// `extra` is a single style object (not a nested `Style`) so the style array's
// elements stay within react-pdf's strict Text-style typing.
function cell(
  width: number,
  value: number | null,
  fmt: (n: number) => string,
  extra?: Record<string, unknown> | false,
): ReactElement {
  return h(Text_, {
    style: [styles.qty, { width, paddingLeft: GAP }, value == null && styles.qtyMissing, extra],
  },
    value == null ? "—" : fmt(value));
}

function replicateRow(
  rep: LedgerBatch["replicates"][number],
  isLast: boolean,
): ReactElement {
  return v([styles.tr, isLast && { borderBottomWidth: 0 }], { wrap: false },
    t([styles.repRef, { width: COL.ref }], rep.ref),
    v({ flex: 1, paddingRight: 6 }, {},
      t(styles.repCode, rep.sampleCode),
      rep.labName ? t(styles.repLab, rep.labName) : null,
    ),
    h(Text, { style: [styles.day, { width: COL.day, paddingLeft: GAP }] }, rep.samplingDay ?? "—"),
    cell(COL.hc, rep.hToCorg, nf3),
    cell(COL.oc, rep.oToCorg, nf3),
    cell(COL.totc, rep.totalCarbonPercent, nf1),
    cell(COL.orgc, rep.organicCarbonPercent, nf1),
    cell(COL.inorg, rep.inorganicCarbonPercent, nf1, rep.inorganicDerived && styles.qtyDerived),
  );
}

function batchSection(batch: LedgerBatch): ReactElement {
  const distrib =
    batch.distinctDayCount >= 3
      ? `${batch.distinctDayCount} distinct days`
      : `${batch.distinctDayCount} distinct day(s) — review distribution`;
  const header = v(styles.sectionHead, { minPresenceAhead: 80 },
    v(styles.rule, {}),
    t(styles.sectionName, `Credit batch ${batch.creditBatchCode}`),
    t(styles.sectionTag, `${batch.replicateCount} replicates`),
    t(styles.sectionEqn, `${distrib} · ${nfi(batch.productMassKg)} kg product`),
  );
  const th = v(styles.th, {},
    t([styles.thText, { width: COL.ref }], "#"),
    t([styles.thText, { flex: 1 }], "Sample"),
    t([styles.thText, { width: COL.day, paddingLeft: GAP }], "Day"),
    t([styles.thText, { width: COL.hc, textAlign: "right", paddingLeft: GAP }], "H/C_org"),
    t([styles.thText, { width: COL.oc, textAlign: "right", paddingLeft: GAP }], "O/C_org"),
    t([styles.thText, { width: COL.totc, textAlign: "right", paddingLeft: GAP }], "Tot C %"),
    t([styles.thText, { width: COL.orgc, textAlign: "right", paddingLeft: GAP }], "Org C %"),
    t([styles.thText, { width: COL.inorg, textAlign: "right", paddingLeft: GAP }], "Inorg C %"),
  );
  const rows = batch.replicates.map((rep, i) =>
    replicateRow(rep, i === batch.replicates.length - 1),
  );
  const foot = v(styles.tfoot, {},
    v({ width: COL.ref + 4 }, {}),
    v({ flex: 1 }, {},
      t(styles.subLabel, "Submitted"),
      t(styles.subN, `mean ± s.d. · n=${batch.replicateCount}`),
    ),
    h(Text, { style: [styles.subVal, { width: COL.day, paddingLeft: GAP, color: C.ink40 }] }, ""),
    h(Text, { style: [styles.subVal, { width: COL.hc, paddingLeft: GAP }] }, stat(batch.hToCorg, nf3)),
    h(Text, { style: [styles.subVal, { width: COL.oc, paddingLeft: GAP, color: C.ink55 }] }, stat(batch.oToCorg, nf3)),
    h(Text, { style: [styles.subVal, { width: COL.totc, paddingLeft: GAP }] }, stat(batch.totalCarbonPercent, nf1)),
    h(Text, { style: [styles.subVal, { width: COL.orgc, paddingLeft: GAP, color: C.ink40 }] }, "—"),
    h(Text, { style: [styles.subVal, { width: COL.inorg, paddingLeft: GAP }] }, stat(batch.inorganicCarbonPercent, nf1)),
  );
  return v(styles.section, {}, header, v(styles.table, {}, th, ...rows, foot));
}

function soilBlock(model: DurabilityLedgerModel): ReactElement {
  const s = model.soil;
  const floorLine = s.temperatureFloored
    ? `Declared ${nf1(s.declaredSoilTemperatureC)} °C raised to the 7 °C floor (§5.1.1.3.1).`
    : `Declared value is at or above the 7 °C floor — submitted as declared.`;
  const left = v(styles.soilCell, {},
    t(styles.soilLabel, "Effective — submitted"),
    h(Text, { style: styles.soilBig }, nf1(s.effectiveSoilTemperatureC), h(Text, { style: styles.soilUnit }, " °C")),
    t(styles.soilLine, `Declared ${nf1(s.declaredSoilTemperatureC)} °C`),
  );
  const right = v([styles.soilCell, styles.soilCellLast], {},
    t(styles.soilLabel, "Reference basis"),
    t(styles.soilNote, `${s.source ? `${s.source}. ` : ""}${floorLine}`),
    t([styles.soilNote, { color: C.ink55 }],
      "Project-area annual average from an approved global soil-temperature dataset; justification recorded in the PDD. Higher T_soil lowers the durable fraction (conservative).",
    ),
  );
  return v(styles.soil, { wrap: false },
    v(styles.soilHead, {}, t(styles.soilHeadText, "Facility soil-temperature reference")),
    v(styles.soilBody, {}, left, right),
  );
}

function apparatus(): ReactElement {
  const note = v(styles.noteCol, {},
    t(styles.noteH, "Method note"),
    t(styles.noteBody,
      "Each credit batch is characterised by at least 3 independent lab replicates distributed across " +
      "distinct production runs/days (§8.3.1). This sheet reconciles those raw replicate values " +
      "into the per-batch mean ± standard deviation submitted as the batch's measurement sample, " +
      "and records the §3 Table 2 permanence verdict (molar H/C_org < 0.5 AND O/C_org < 0.2) judged " +
      "on the pooled mean. The lab's own certificate of analysis remains attached as a Source on the " +
      "Removal; this is noma's working showing how the submitted figures derive from it. The registry " +
      "computes the durable fraction from these inputs and the soil-temperature reference.",
    ),
  );
  const legendRow = (k: string, d: string) =>
    v(styles.legendRow, {}, t(styles.legendKey, k), t(styles.legendDesc, d));
  const legend = v(styles.legendCol, {},
    t(styles.noteH, "Thresholds & notation"),
    legendRow("H/C_org < 0.5", "Molar hydrogen-to-organic-carbon permanence ceiling."),
    legendRow("O/C_org < 0.2", "Molar oxygen-to-organic-carbon permanence ceiling."),
    legendRow("mean ± s.d.", "Pooled replicate mean and sample standard deviation."),
    legendRow("Inorg C (plum)", "Derived as Total − Organic carbon (Eq.2) when not measured."),
    legendRow("Submitted", "H/C_org, total + inorganic carbon, product mass · the measurement sample."),
  );
  return v(styles.apparatus, {}, note, legend);
}

function footer(model: DurabilityLedgerModel): ReactElement {
  const date = model.generatedAtIso.slice(0, 10);
  return v(styles.footer, { fixed: true },
    t(styles.footerText, `NOMA DMRV · DURABILITY EVIDENCE LEDGER · ${model.batches.length} BATCHES`),
    h(Text, {
      style: styles.footerText,
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
        `GENERATED ${date} · PAGE ${pageNumber} / ${totalPages}`,
    }),
  );
}

function buildDocument(model: DurabilityLedgerModel): ReactElement {
  return h(Document, {
    title: `200-Year Durability Evidence Ledger${model.memberBatchCodes ? ` — ${model.memberBatchCodes}` : ""}`,
    author: "noma dMRV",
    subject: "Per-batch raw-replicate to submitted durability figures + eligibility verdicts",
  },
    h(Page, { size: "A4", style: styles.page },
      masthead(model),
      eligibilityBand(model),
      ...model.batches.map(batchSection),
      soilBlock(model),
      apparatus(),
      footer(model),
    ),
  );
}

export async function renderDurabilityLedgerPdf(
  model: DurabilityLedgerModel,
): Promise<Buffer> {
  registerEvidenceLedgerFonts();
  return renderToBuffer(
    buildDocument(model) as Parameters<typeof renderToBuffer>[0],
  );
}
