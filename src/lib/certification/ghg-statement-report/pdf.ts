import { createElement as h, type ReactElement } from "react";
import { Document, Page, StyleSheet, Text } from "@react-pdf/renderer";
import {
  C,
  MONO,
  renderLedgerToBuffer,
  t,
  theme,
  v,
} from "@/lib/certification/evidence-ledger/pdf-theme";
import type {
  GhgStatementReportEntry,
  GhgStatementReportModel,
} from "./model";

const styles = {
  ...theme,
  ...StyleSheet.create({
    summary: {
      marginTop: 14,
      borderWidth: 1.5,
      borderColor: C.ink,
      flexDirection: "row",
    },
    summaryCell: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRightWidth: 1,
      borderRightColor: C.ink12,
    },
    summaryLast: { borderRightWidth: 0 },
    summaryLabel: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.ink55,
      textTransform: "uppercase",
    },
    summaryValue: {
      fontFamily: MONO,
      fontSize: 14,
      fontWeight: 500,
      marginTop: 4,
    },
    summaryUnit: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.ink40,
      marginTop: 2,
    },
    paragraph: {
      fontSize: 8.5,
      lineHeight: 1.5,
      color: C.ink70,
    },
    controlGrid: { flexDirection: "row", flexWrap: "wrap" },
    controlPair: { width: "50%", paddingRight: 12, marginBottom: 6 },
    controlPairWide: { width: "100%" },
    compactMetaValue: { fontSize: 7 },
    entryHeader: {
      fontFamily: MONO,
      fontSize: 8,
      color: C.plum,
      marginBottom: 3,
    },
    entryMeta: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.ink55,
      lineHeight: 1.45,
    },
    hash: { fontFamily: MONO, fontSize: 6.5, color: C.ink55 },
    source: {
      fontFamily: MONO,
      fontSize: 6.5,
      color: C.ink70,
      marginTop: 2,
    },
    review: {
      borderLeftWidth: 3,
      borderLeftColor: C.plum,
      backgroundColor: C.sea,
      padding: 9,
      marginBottom: 7,
    },
    reviewLabel: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.plum,
      textTransform: "uppercase",
      marginBottom: 3,
    },
    footerHash: {
      fontFamily: MONO,
      fontSize: 6.2,
      color: C.ink40,
    },
  }),
};

const formatKg = (value: number | null): string =>
  value === null
    ? "Not available"
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });

const formatPreparedAt = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

function sectionHeading(title: string, tag?: string): ReactElement {
  return v(styles.sectionHead, { minPresenceAhead: 55 },
    v([styles.rule, { backgroundColor: C.plum }], {}),
    t(styles.sectionName, title),
    tag ? t(styles.sectionTag, tag) : null,
  );
}

function section(
  title: string,
  children: ReactElement | ReactElement[],
  tag?: string,
): ReactElement {
  return v(styles.section, {}, sectionHeading(title, tag), ...(Array.isArray(children) ? children : [children]));
}

function controlPair(
  label: string,
  value: string,
  options: { wide?: boolean; compact?: boolean } = {},
): ReactElement {
  return v(
    [styles.controlPair, options.wide && styles.controlPairWide],
    {},
    t(styles.metaLabel, label),
    t(
      [styles.metaVal, options.compact && styles.compactMetaValue],
      value,
    ),
  );
}

function mastheadPair(label: string, value: string): ReactElement {
  return v(styles.metaPair, {},
    t(styles.metaLabel, label),
    t(styles.metaVal, value),
  );
}

function summaryCell(
  label: string,
  value: string,
  isLast = false,
): ReactElement {
  return v([styles.summaryCell, isLast && styles.summaryLast], {},
    t(styles.summaryLabel, label),
    t(styles.summaryValue, value),
    t(styles.summaryUnit, "kg CO2e"),
  );
}

function entryRow(entry: GhgStatementReportEntry): ReactElement {
  const sources =
    entry.sourceBindings.length > 0
      ? entry.sourceBindings.join(", ")
      : "No Source IDs were present in the frozen submission snapshot.";
  return v(styles.tr, { wrap: false },
    v({ flex: 1 }, {},
      t(styles.entryHeader, entry.externalRemovalId),
      t(styles.entryMeta, `Local Removal ${entry.localRemovalId}`),
      t(
        styles.entryMeta,
        `Submitted version ${entry.removalSubmissionVersion} | ${entry.startedOn} to ${entry.completedOn}`,
      ),
      t(styles.hash, `Payload SHA-256 ${entry.removalPayloadHash}`),
      t(styles.source, `Frozen Sources: ${sources}`),
    ),
    v({ width: 112, alignItems: "flex-end" }, {},
      t(styles.entryMeta, `Net ${formatKg(entry.netRemovedKg)}`),
      t(
        styles.entryMeta,
        `Before uncertainty ${formatKg(entry.netRemovedWithoutDiscountKg)}`,
      ),
      t(
        styles.entryMeta,
        `Standard deviation ${formatKg(entry.netRemovedStandardDeviationKg)}`,
      ),
      t(styles.entryMeta, `Supplier ${formatKg(entry.supplierCreditKg)}`),
      t(styles.entryMeta, `Buffer ${formatKg(entry.bufferPoolKg)}`),
    ),
  );
}

function reviewBlock(label: string, body: string): ReactElement {
  return v(styles.review, { wrap: false },
    t(styles.reviewLabel, label),
    t(styles.paragraph, body),
  );
}

function buildDocument(model: GhgStatementReportModel): ReactElement {
  const control = model.documentControl;
  const masthead = v(styles.masthead, {},
    v({}, {},
      v(styles.wordmarkRow, {},
        t(styles.wordmark, "noma"),
        t(styles.wordmarkSub, "DMRV | GHG STATEMENT"),
      ),
      t(styles.eyebrow, "QUALITATIVE SUPPORT AND RECONCILIATION"),
      h(Text, { style: styles.title }, "GHG Statement Report"),
    ),
    v(styles.metaCol, {},
      mastheadPair("Report version", String(model.reportVersion)),
      mastheadPair("Prepared", formatPreparedAt(model.preparedAt)),
      mastheadPair("Facility", control.facilityCode),
    ),
  );
  const totals = v(styles.summary, {},
    summaryCell("Live net removed", formatKg(model.totals.netRemovedKg)),
    summaryCell(
      "Before uncertainty",
      formatKg(model.totals.netRemovedWithoutDiscountKg),
    ),
    summaryCell(
      "Uncertainty discount",
      formatKg(model.totals.uncertaintyDiscountKg),
    ),
    summaryCell("Supplier allocation", formatKg(model.totals.supplierCreditKg)),
    summaryCell("Buffer pool", formatKg(model.totals.bufferPoolKg), true),
  );
  const documentControl = section(
    "Document control",
    v(styles.controlGrid, {},
      controlPair("Supplier organization", control.organizationName),
      controlPair("Facility code", control.facilityCode),
      controlPair("Registry project", control.externalProjectId),
      controlPair("GHG Statement", control.externalGhgStatementId),
      controlPair(
        "Reporting period",
        `${control.reportingPeriodStartOn} to ${control.reportingPeriodEndOn}`,
      ),
      controlPair(
        "Pinned versions",
        `Isometric Standard ${control.standardVersion}; Biochar Protocol ${control.protocolVersion}`,
      ),
      controlPair("Source fingerprint", model.sourceFingerprint, {
        wide: true,
        compact: true,
      }),
      controlPair("Report model", String(model.modelVersion)),
    ),
  );
  const membership = section(
    "GHG Entry and Removal index",
    v(styles.table, {}, ...model.entries.map(entryRow)),
    `${model.entries.length} exact members`,
  );
  const reviews = [
    reviewBlock(
      "System boundary and methodology",
      model.narratives.systemBoundaryAndMethodology,
    ),
    reviewBlock("Evidence and Source index", model.narratives.evidenceIndex),
    reviewBlock(
      "Uncertainty and sensitivity",
      model.narratives.uncertaintyAndSensitivity,
    ),
    reviewBlock(
      "Data quality, exclusions, incidents, and exceptions",
      model.narratives.dataQualityAndExceptions,
    ),
    reviewBlock(
      "Monitoring and durability",
      model.narratives.monitoringAndDurability,
    ),
  ];
  const methodology = section(
    "Methodology and reviewed narrative",
    reviews,
    "Human reviewed",
  );
  const approval = section(
    "Review acknowledgment",
    reviewBlock("Operator acknowledgment", model.narratives.approvalStatement),
    "Required before approval",
  );
  const footer = v(styles.footer, { fixed: true },
    t(
      styles.footerHash,
      `NOMA DMRV | IMMUTABLE REPORT V${model.reportVersion} | ${model.sourceFingerprint}`,
    ),
    h(Text, {
      style: styles.footerText,
      render: ({
        pageNumber,
        totalPages,
      }: {
        pageNumber: number;
        totalPages: number;
      }) => `PAGE ${pageNumber} / ${totalPages}`,
    }),
  );

  return h(
    Document,
    {
      title: `GHG Statement Report v${model.reportVersion}`,
      author: "noma dMRV",
      subject: "GHG Statement qualitative support and reconciliation",
    },
    h(
      Page,
      { size: "A4", style: styles.page },
      masthead,
      totals,
      documentControl,
      membership,
      methodology,
      approval,
      footer,
    ),
  );
}

export async function renderGhgStatementReportPdf(
  model: GhgStatementReportModel,
): Promise<Buffer> {
  return renderLedgerToBuffer(buildDocument(model));
}
