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
import { canonicalizePdfBytes } from "./canonical-pdf";
import type {
  GhgStatementReportEntry,
  GhgStatementReportModel,
} from "./model";

// Column widths in points (A4 content ≈ 527pt; the GHG Entry column flexes).
const COL = {
  net: 58,
  beforeUncertainty: 76,
  stdDeviation: 58,
  supplier: 58,
  buffer: 58,
} as const;
const CELL_GAP = 6;

/**
 * Document metadata must be a pure function of the frozen report model.
 *
 * Left unset, @react-pdf/renderer defaults `creationDate` to `new Date()` and
 * `creator`/`producer` to `"react-pdf"`, and @react-pdf/pdfkit derives the
 * trailer `/ID` from an MD5 of exactly that info dictionary
 * (`PDFSecurity.generateFileID`). So two renders of one model differed in the
 * `/CreationDate` string AND in both halves of `/ID`, producing different bytes
 * and a different `contentChecksumSha256` — the value operators and verifiers
 * compare. @react-pdf/renderer 4.5.1 exposes no seam to set `/ID` directly;
 * pinning every info field pins it transitively, and it is not random.
 *
 * These constants are part of the rendered bytes: changing one changes the
 * checksum of every newly prepared report.
 */
const PDF_AUTHOR = "noma dMRV";
const PDF_CREATOR = "noma dMRV";
const PDF_PRODUCER = "noma dMRV GHG statement report";
const PDF_SUBJECT = "Automatically generated GHG Statement data reconciliation";

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
    entryQty: { ...theme.qty, fontSize: 8 },
    footerHash: {
      fontFamily: MONO,
      fontSize: 6.2,
      color: C.ink40,
    },
  }),
};

// Hand-rolled grouping instead of toLocaleString: locale formatting depends
// on the runtime's ICU build, and every byte of this document must render
// identically across environments (contentChecksumSha256 contract).
const KG_DECIMAL_PLACES = 3;
const THOUSANDS_GROUPING = /\B(?=(\d{3})+(?!\d))/g;

const formatKg = (value: number | null): string => {
  if (value === null) return "Not available";
  const [whole, fraction] = Math.abs(value)
    .toFixed(KG_DECIMAL_PLACES)
    .split(".");
  const grouped = whole.replace(THOUSANDS_GROUPING, ",");
  return `${value < 0 ? "-" : ""}${grouped}.${fraction}`;
};

const formatPreparedAt = (preparedAt: Date): string =>
  `${preparedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * The one timestamp the renderer may stamp: frozen on the model, never the
 * clock. `buildGhgStatementReportModel` rejects an unparseable `preparedAt`,
 * so reaching the throw here means the model bypassed that builder.
 */
const pinnedTimestamp = (preparedAt: string): Date => {
  const parsed = new Date(preparedAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      "GHG statement report model preparedAt is not a parseable timestamp",
    );
  }
  return parsed;
};

function sectionHeading(
  title: string,
  tag?: string,
  note?: string,
): ReactElement {
  return v(styles.sectionHead, { minPresenceAhead: 55 },
    v([styles.rule, { backgroundColor: C.plum }], {}),
    t(styles.sectionName, title),
    tag ? t(styles.sectionTag, tag) : null,
    note ? t(styles.sectionEqn, note) : null,
  );
}

function section(
  title: string,
  children: ReactElement | ReactElement[],
  tag?: string,
  note?: string,
): ReactElement {
  return v(styles.section, {}, sectionHeading(title, tag, note), ...(Array.isArray(children) ? children : [children]));
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

const formatCell = (value: number | null): string =>
  value === null ? "n/a" : formatKg(value);

function entryTableHeader(): ReactElement {
  return v(styles.th, {},
    t([styles.thText, { flex: 1 }], "GHG Entry"),
    t([styles.thText, { width: COL.net, textAlign: "right" }], "Net"),
    t(
      [
        styles.thText,
        {
          width: COL.beforeUncertainty,
          textAlign: "right",
          paddingLeft: CELL_GAP,
        },
      ],
      "Before uncert.",
    ),
    t(
      [
        styles.thText,
        { width: COL.stdDeviation, textAlign: "right", paddingLeft: CELL_GAP },
      ],
      "Std dev",
    ),
    t(
      [
        styles.thText,
        { width: COL.supplier, textAlign: "right", paddingLeft: CELL_GAP },
      ],
      "Supplier",
    ),
    t(
      [
        styles.thText,
        { width: COL.buffer, textAlign: "right", paddingLeft: CELL_GAP },
      ],
      "Buffer",
    ),
  );
}

function entryRow(entry: GhgStatementReportEntry): ReactElement {
  return v(styles.tr, { wrap: false },
    v({ flex: 1, paddingRight: 8 }, {},
      t(styles.entryHeader, entry.externalEntryId),
      t(
        styles.entryMeta,
        `${entry.startedOn} to ${entry.completedOn}`,
      ),
    ),
    t([styles.entryQty, { width: COL.net }], formatCell(entry.netRemovedKg)),
    t(
      [
        styles.entryQty,
        { width: COL.beforeUncertainty, paddingLeft: CELL_GAP },
      ],
      formatCell(entry.netRemovedWithoutDiscountKg),
    ),
    t(
      [styles.entryQty, { width: COL.stdDeviation, paddingLeft: CELL_GAP }],
      formatCell(entry.netRemovedStandardDeviationKg),
    ),
    t(
      [styles.entryQty, { width: COL.supplier, paddingLeft: CELL_GAP }],
      formatCell(entry.supplierCreditKg),
    ),
    t(
      [styles.entryQty, { width: COL.buffer, paddingLeft: CELL_GAP }],
      formatCell(entry.bufferPoolKg),
    ),
  );
}

function buildDocument(model: GhgStatementReportModel): ReactElement {
  const control = model.documentControl;
  const preparedAt = pinnedTimestamp(model.preparedAt);
  const masthead = v(styles.masthead, {},
    v({}, {},
      v(styles.wordmarkRow, {},
        t(styles.wordmark, "noma"),
        t(styles.wordmarkSub, "DMRV | GHG STATEMENT"),
      ),
      t(styles.eyebrow, "AUTOMATIC DATA RECONCILIATION"),
      h(Text, { style: styles.title }, "GHG Statement Data Summary"),
    ),
    v(styles.metaCol, {},
      mastheadPair("Report version", String(model.reportVersion)),
      mastheadPair("Prepared", formatPreparedAt(preparedAt)),
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
      controlPair(
        "Project protocol version",
        control.configuredProtocolVersion ?? "Not configured",
      ),
      controlPair("Source fingerprint", model.sourceFingerprint, {
        wide: true,
        compact: true,
      }),
      controlPair(
        "Scope",
        "Registry data reconciliation only; qualitative VVB and project documentation is not included.",
        { wide: true },
      ),
      controlPair("Report model", String(model.modelVersion)),
    ),
  );
  const membership = section(
    "GHG Entry index",
    v(styles.table, {}, entryTableHeader(), ...model.entries.map(entryRow)),
    `${model.entries.length} exact ${
      model.entries.length === 1 ? "member" : "members"
    }`,
    "All values kg CO2e",
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
      title: `GHG Statement Data Summary v${model.reportVersion}`,
      author: PDF_AUTHOR,
      subject: PDF_SUBJECT,
      creator: PDF_CREATOR,
      producer: PDF_PRODUCER,
      creationDate: preparedAt,
      modificationDate: preparedAt,
    },
    h(
      Page,
      { size: "A4", style: styles.page },
      masthead,
      totals,
      documentControl,
      membership,
      footer,
    ),
  );
}

/**
 * Render the report to byte-stable PDF bytes: the same model always yields the
 * same buffer (and therefore the same `contentChecksumSha256`), whatever the
 * wall clock says. See the metadata constants above and `canonical-pdf.ts` for
 * the three drift sources this closes.
 */
export async function renderGhgStatementReportPdf(
  model: GhgStatementReportModel,
): Promise<Buffer> {
  return canonicalizePdfBytes(await renderLedgerToBuffer(buildDocument(model)));
}
