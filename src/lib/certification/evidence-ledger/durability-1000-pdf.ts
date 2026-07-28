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

const COL = { ref: 28, day: 64, carbon: 92, sFraction: 92 };

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
      "Total carbon fraction",
    ),
    t(
      [styles.thText, { width: COL.sFraction, textAlign: "right" }],
      "R0 at or above 2%",
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
        fraction(replicate.carbonContentFraction),
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
    v(styles.table, {}, tableHead, ...rows),
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
        "Total carbon is shown as the submitted dry-basis fraction. The R0 fraction is the " +
        "share of reflectance readings at or above 2%. The registry combines the full lists " +
        "with the product mass. This ledger records noma's inputs and does not replace the " +
        "laboratory certificate of analysis.",
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
    legendRow("Carbon", "Total carbon dry-basis fraction, from 0 to 1."),
    legendRow("R0 fraction", "Reflectance readings at or above 2%, from 0 to 1."),
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
        "Per-replicate total carbon and reflectance fractions submitted for 1000-year durability",
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
