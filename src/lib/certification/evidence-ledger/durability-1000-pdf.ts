import { createElement as h, type ReactElement } from "react";
import { Document, Page, StyleSheet, Text } from "@react-pdf/renderer";
import {
  C,
  MONO,
  SANS,
  renderLedgerToBuffer,
  t,
  theme,
  v,
} from "./pdf-theme";
import type {
  ThousandYearDurabilityLedgerModel,
  ThousandYearLedgerBatch,
} from "./durability-types";

const COL = {
  ref: 24,
  day: 54,
  carbon: 66,
  sFraction: 62,
};

const styles = {
  ...theme,
  ...StyleSheet.create({
    rule: { ...theme.rule, backgroundColor: C.plum },
    tr: { ...theme.tr, alignItems: "flex-start" },
    sampleCode: { fontFamily: SANS, fontSize: 9 },
    sampleLab: {
      fontFamily: SANS,
      fontSize: 6.5,
      color: C.ink40,
      marginTop: 1,
    },
    mono: { fontFamily: MONO, fontSize: 8.5 },
    claimBody: {
      flexDirection: "row",
      paddingVertical: 12,
      paddingHorizontal: 10,
    },
    claimCell: {
      flex: 1,
      borderRightWidth: 1,
      borderRightColor: C.ink12,
      paddingHorizontal: 10,
    },
    claimCellFirst: { paddingLeft: 0 },
    claimCellLast: { borderRightWidth: 0, paddingRight: 0 },
    claimLabel: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.ink40,
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    claimValue: {
      fontFamily: MONO,
      fontSize: 18,
      fontWeight: 500,
      marginTop: 3,
    },
    legendKey: { ...theme.legendKey, width: 82 },
    calculation: {
      borderTopWidth: 1,
      borderTopColor: C.ink12,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    calculationLine: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.ink70,
      marginTop: 2,
    },
  }),
};

const fraction = (value: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 6,
  });

const mass = (value: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

function masthead(model: ThousandYearDurabilityLedgerModel): ReactElement {
  const left = v(
    {},
    {},
    v(
      styles.wordmarkRow,
      {},
      t(styles.wordmark, "noma"),
      t(styles.wordmarkSub, "dMRV · DARK EARTH CARBON"),
    ),
    t(styles.eyebrow, "BIOCHAR IN AGRICULTURAL SOILS · 1000 YEAR"),
    h(Text, { style: styles.title }, "Durability Evidence Ledger"),
  );
  const pair = (label: string, value: string) =>
    v(
      styles.metaPair,
      {},
      t(styles.metaLabel, label),
      t(styles.metaVal, value),
    );
  const right = v(
    styles.metaCol,
    {},
    pair("Member batches", model.memberBatchCodes ?? "—"),
    pair("Facility", model.facilityName ?? "—"),
    pair("Registry project", model.externalProjectId ?? "—"),
    pair(
      "Evidence set",
      `${model.batches.length} batches · ${model.totalReplicates} replicates`,
    ),
  );
  return v(styles.masthead, {}, left, right);
}

function claimBand(model: ThousandYearDurabilityLedgerModel): ReactElement {
  const totalMass = model.batches.reduce(
    (total, batch) => total + batch.productMassKg,
    0,
  );
  const claimCell = (
    label: string,
    value: string,
    extra?: Record<string, unknown>,
  ) =>
    v(
      [styles.claimCell, extra],
      {},
      t(styles.claimLabel, label),
      t(styles.claimValue, value),
    );
  return v(
    styles.claim,
    {},
    v(
      styles.claimHead,
      {},
      t(styles.claimHeadLabel, "Submitted durability evidence"),
      t(styles.claimHeadEq, "raw measurement-sample inputs"),
    ),
    v(
      styles.claimBody,
      {},
      claimCell(
        "Credit batches",
        String(model.batches.length),
        styles.claimCellFirst,
      ),
      claimCell("Complete replicates", String(model.totalReplicates)),
      claimCell(
        "Product mass",
        `${mass(totalMass)} kg`,
        styles.claimCellLast,
      ),
    ),
  );
}

function batchSection(batch: ThousandYearLedgerBatch): ReactElement {
  const header = v(
    styles.sectionHead,
    { minPresenceAhead: 80 },
    v(styles.rule, {}),
    t(styles.sectionName, `Credit batch ${batch.creditBatchCode}`),
    t(styles.sectionTag, `${batch.replicateCount} replicates`),
    t(styles.sectionEqn, `${mass(batch.productMassKg)} kg product mass`),
  );
  const tableHead = v(
    styles.th,
    {},
    t([styles.thText, { width: COL.ref }], "#"),
    t([styles.thText, { flex: 1 }], "Sample"),
    t([styles.thText, { width: COL.day }], "Sampling day"),
    t(
      [styles.thText, { width: COL.carbon, textAlign: "right" }],
      "Total C",
    ),
    t(
      [styles.thText, { width: COL.carbon, textAlign: "right" }],
      "Measured inorganic C",
    ),
    t(
      [styles.thText, { width: COL.carbon, textAlign: "right" }],
      "Calculated organic C",
    ),
    t(
      [styles.thText, { width: COL.sFraction, textAlign: "right" }],
      "s_fraction",
    ),
  );
  const rows = batch.replicates.map((replicate, index) =>
    v(
      [
        styles.tr,
        index === batch.replicates.length - 1 && styles.trLast,
      ],
      { wrap: false },
      t([styles.mono, { width: COL.ref }], replicate.ref),
      v(
        { flex: 1 },
        {},
        t(styles.sampleCode, replicate.sampleCode),
        replicate.labName ? t(styles.sampleLab, replicate.labName) : null,
      ),
      t(
        [styles.mono, { width: COL.day }],
        replicate.samplingDay ?? "—",
      ),
      t(
        [styles.mono, { width: COL.carbon, textAlign: "right" }],
        fraction(replicate.totalCarbonFraction),
      ),
      t(
        [styles.mono, { width: COL.carbon, textAlign: "right" }],
        replicate.inorganicCarbonFraction == null
          ? "—"
          : fraction(replicate.inorganicCarbonFraction),
      ),
      t(
        [styles.mono, { width: COL.carbon, textAlign: "right" }],
        replicate.calculatedOrganicCarbonFraction == null
          ? "—"
          : fraction(replicate.calculatedOrganicCarbonFraction),
      ),
      t(
        [styles.mono, { width: COL.sFraction, textAlign: "right" }],
        fraction(replicate.sFraction),
      ),
    ),
  );
  return v(
    styles.section,
    {},
    header,
    v(
      styles.table,
      {},
      tableHead,
      ...rows,
      v(
        styles.calculation,
        {},
        t(styles.calculationLine, `Component: ${batch.componentKey}`),
        t(styles.calculationLine, `Formula/version: ${batch.formulaVersion}`),
        t(styles.calculationLine, `Semantics: ${batch.semanticsLabel}`),
        t(
          styles.calculationLine,
          `Raw durability ${fraction(batch.rawDurability)} · ` +
            `Capped durability ${fraction(batch.cappedDurability)} · ` +
            `0.95 cap applied ${batch.capApplied ? "yes" : "no"}`,
        ),
      ),
    ),
  );
}

function apparatus(): ReactElement {
  const note = v(
    styles.noteCol,
    {},
    t(styles.noteH, "Method note"),
    t(
      styles.noteBody,
      "Each row is one complete laboratory replicate sent in the registry measurement sample. " +
        "Organic carbon is calculated within each row as total minus directly measured inorganic carbon. " +
        "No total-minus-organic fallback supplies inorganic carbon on the current path. The registry " +
        "combines the submitted lists with product mass and remains authoritative. This local math is " +
        "explanatory and does not replace the laboratory certificate of analysis.",
    ),
  );
  const legendRow = (key: string, description: string) =>
    v(
      styles.legendRow,
      {},
      t(styles.legendKey, key),
      t(styles.legendDesc, description),
    );
  const legend = v(
    styles.legendCol,
    {},
    t(styles.noteH, "Submitted fields"),
    legendRow("Total C", "Submitted total carbon dry-basis fraction."),
    legendRow("Inorganic C", "Submitted directly measured dry-basis fraction."),
    legendRow("Organic C", "Calculated row by row as Total C minus Inorganic C."),
    legendRow("s_fraction", "Reflectance readings at or above 2%, from 0 to 1."),
    legendRow("Product mass", "Applied dry biochar mass in kilograms."),
  );
  return v(styles.apparatus, {}, note, legend);
}

function footer(model: ThousandYearDurabilityLedgerModel): ReactElement {
  const date = model.generatedAtIso.slice(0, 10);
  return v(
    styles.footer,
    { fixed: true },
    t(
      styles.footerText,
      `NOMA DMRV · DURABILITY EVIDENCE LEDGER · ${model.batches.length} BATCHES`,
    ),
    h(Text, {
      style: styles.footerText,
      render: ({
        pageNumber,
        totalPages,
      }: {
        pageNumber: number;
        totalPages: number;
      }) => `GENERATED ${date} · PAGE ${pageNumber} / ${totalPages}`,
    }),
  );
}

function buildDocument(
  model: ThousandYearDurabilityLedgerModel,
): ReactElement {
  return h(
    Document,
    {
      title: `1000-Year Durability Evidence Ledger${model.memberBatchCodes ? ` · ${model.memberBatchCodes}` : ""}`,
      author: "noma dMRV",
      subject:
        "Per-replicate total, measured inorganic, calculated organic carbon, and reflectance fractions for 1000-year durability",
    },
    h(
      Page,
      { size: "A4", style: styles.page },
      masthead(model),
      claimBand(model),
      ...model.batches.map(batchSection),
      apparatus(),
      footer(model),
    ),
  );
}

export async function renderThousandYearDurabilityLedgerPdf(
  model: ThousandYearDurabilityLedgerModel,
): Promise<Buffer> {
  return renderLedgerToBuffer(buildDocument(model));
}
