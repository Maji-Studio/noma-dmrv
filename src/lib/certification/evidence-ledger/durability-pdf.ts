/**
 * 200-Year Durability Evidence Ledger — react-pdf renderer.
 *
 * Sibling to the transport ledger (`pdf.ts`): the design tokens and shared
 * document chrome come from ./pdf-theme, built from a pure
 * `DurabilityLedgerModel`. `createElement` (no JSX) so this renders identically
 * under Next's server bundle and a plain Node/tsx verifier.
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
import { createElement as h, type ReactElement } from "react";
import { Document, Page, StyleSheet, Text } from "@react-pdf/renderer";
import { formatCount, pluralize } from "@/lib/copy-utils";
import { C, MONO, SANS, Text_, renderLedgerToBuffer, t, theme, v } from "./pdf-theme";
import type {
  DurabilityLedgerModel,
  LedgerBatch,
  LedgerStat,
} from "./durability-types";

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
  if (value == null) return "Not available";
  return value.stdDev == null
    ? fmt(value.mean)
    : `${fmt(value.mean)} ± ${fmt(value.stdDev)}`;
}

// Chrome (page, masthead, claim frame, section head, table frame, apparatus,
// footer) comes from the shared theme; the entries below are durability-specific.
// Deliberate divergences spread the theme entry so the delta stays explicit.
const styles = {
  ...theme,
  ...StyleSheet.create({
  // Eligibility verdict band body (the hero / claim)
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

  // Per-batch reconciliation section — head/table chrome from theme, with
  // three deliberate divergences: the section rule is always plum (no
  // per-category triad here), the eight tight columns need smaller header type
  // than the transport ledger, and two-line sample cells top-align their rows.
  rule: { ...theme.rule, backgroundColor: C.plum },
  thText: { ...theme.thText, fontSize: 6.5, letterSpacing: 0.6 },
  tr: { ...theme.tr, alignItems: "flex-start" },

  repRef: { fontFamily: MONO, fontSize: 8.5, color: C.ink70, fontWeight: 500 },
  repCode: { fontFamily: SANS, fontSize: 9 },
  repLab: { fontFamily: SANS, fontSize: 6.5, color: C.ink40, marginTop: 1 },
  day: { fontFamily: MONO, fontSize: 8, color: C.ink55 },
  qtyDerived: { color: C.plum },
  qtyMissing: { color: C.ink25 },

  // Two-line "Submitted / n=…" label: top-aligned, slightly taller footer.
  tfoot: { ...theme.tfoot, paddingVertical: 7, alignItems: "flex-start" },
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

  // Long threshold keys ("H/C_org < 0.5"): 88pt column.
  legendKey: { ...theme.legendKey, width: 88 },
  }),
};

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
    pair("Member batches", model.memberBatchCodes ?? "None"),
    pair("Facility", model.facilityName ?? "Not available"),
    pair("Registry project", model.externalProjectId ?? "Not set"),
    pair(
      "Batches reconciled",
      `${model.batches.length} · ${formatCount(model.totalReplicates, "replicate")}`,
    ),
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
    t([styles.ratioVal, { color }], mean == null ? "Not available" : nf3(mean)),
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
    t(styles.claimHeadLabel, "Prepared for submission: durability eligibility"),
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
      `${model.eligibleBatchCount} of ${formatCount(model.batches.length, "batch", "batches")} eligible`),
    t(styles.claimFootSub,
      allEligible
        ? `all clear H/C_org < 0.5 AND O/C_org < 0.2`
        : `review the flagged ${pluralize(model.batches.length - model.eligibleBatchCount, "batch", "batches")} before submission`),
  );
  return v(styles.claim, {}, head, colHead, ...rows, foot);
}

// One right-aligned numeric replicate cell; "Not recorded" tinted faint when the
// value is missing, plum when the inorganic figure was Eq.2-derived rather than
// measured.
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
    value == null ? "Not recorded" : fmt(value));
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
    h(Text, { style: [styles.day, { width: COL.day, paddingLeft: GAP }] }, rep.samplingDay ?? "Not recorded"),
    cell(COL.hc, rep.hToCorg, nf3),
    cell(COL.oc, rep.oToCorg, nf3),
    cell(COL.totc, rep.totalCarbonPercent, nf1),
    cell(COL.orgc, rep.organicCarbonPercent, nf1),
    cell(COL.inorg, rep.inorganicCarbonPercent, nf1, rep.inorganicDerived && styles.qtyDerived),
  );
}

function batchSection(batch: LedgerBatch): ReactElement {
  const header = v(styles.sectionHead, { minPresenceAhead: 80 },
    v(styles.rule, {}),
    t(styles.sectionName, `Credit batch ${batch.creditBatchCode}`),
    t(styles.sectionTag, formatCount(batch.replicateCount, "replicate")),
    t(styles.sectionEqn, `${nfi(batch.productMassKg)} kg product`),
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
      t(styles.subLabel, "Prepared"),
      t(styles.subN, `mean ± s.d. · n=${batch.replicateCount}`),
    ),
    h(Text, { style: [styles.subVal, { width: COL.day, paddingLeft: GAP, color: C.ink40 }] }, ""),
    h(Text, { style: [styles.subVal, { width: COL.hc, paddingLeft: GAP }] }, stat(batch.hToCorg, nf3)),
    h(Text, { style: [styles.subVal, { width: COL.oc, paddingLeft: GAP, color: C.ink55 }] }, stat(batch.oToCorg, nf3)),
    h(Text, { style: [styles.subVal, { width: COL.totc, paddingLeft: GAP }] }, stat(batch.totalCarbonPercent, nf1)),
    h(Text, { style: [styles.subVal, { width: COL.orgc, paddingLeft: GAP, color: C.ink40 }] }, "Not included"),
    h(Text, { style: [styles.subVal, { width: COL.inorg, paddingLeft: GAP }] }, stat(batch.inorganicCarbonPercent, nf1)),
  );
  return v(styles.section, {}, header, v(styles.table, {}, th, ...rows, foot));
}

function soilBlock(model: DurabilityLedgerModel): ReactElement {
  const s = model.soil;
  const floorLine = s.temperatureFloored
    ? `Declared ${nf1(s.declaredSoilTemperatureC)} °C raised to the 7 °C floor (§5.1.1.3.1).`
    : "The declared value is at or above the 7 °C floor. It is prepared as declared.";
  const left = v(styles.soilCell, {},
    t(styles.soilLabel, "Effective value prepared"),
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
      "Protocol §8.3.1 calls for at least 3 lab replicates per measured production batch, " +
      "representative of the full range of physical characteristics present in that batch. " +
      "This sheet reports the recorded replicate count, and reconciles the raw values " +
      "into the per-batch mean ± standard deviation prepared for the batch's measurement-sample submission, " +
      "and records the §3 Table 2 permanence verdict (molar H/C_org < 0.5 AND O/C_org < 0.2) judged " +
      "on the pooled mean. The lab's own certificate of analysis remains attached as a Source on the " +
      "Removal; this is noma's working showing how the prepared figures derive from it. The registry " +
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
    legendRow("Prepared", "H/C_org, total and inorganic carbon, and product mass included in the measurement-sample submission."),
  );
  return v(styles.apparatus, {}, note, legend);
}

function footer(model: DurabilityLedgerModel): ReactElement {
  const date = model.generatedAtIso.slice(0, 10);
  return v(styles.footer, { fixed: true },
    t(
      styles.footerText,
      `NOMA DMRV · DURABILITY EVIDENCE LEDGER · ${formatCount(model.batches.length, "batch", "batches").toUpperCase()}`,
    ),
    h(Text, {
      style: styles.footerText,
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
        `GENERATED ${date} · PAGE ${pageNumber} / ${totalPages}`,
    }),
  );
}

function buildDocument(model: DurabilityLedgerModel): ReactElement {
  return h(Document, {
    title: `200-Year Durability Evidence Ledger${model.memberBatchCodes ? `: ${model.memberBatchCodes}` : ""}`,
    author: "noma dMRV",
    subject: "Sample values and prepared durability results by credit batch",
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
  return renderLedgerToBuffer(buildDocument(model));
}
