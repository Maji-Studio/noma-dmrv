/**
 * GHG Statement Data Summary — react-pdf renderer.
 *
 * One result. The verifier's first question is "how much did this
 * GHG Statement remove, net", so the net removal is the only large number on
 * the page; the uncertainty operands and the credit split sit beside it as
 * subordinate facts, and the registry coordinates identifying the document
 * sit in the masthead. Everything the operator cannot check against the
 * figures on this page (how the document was prepared, the pinned Standard
 * and Protocol versions the totals were computed under) drops to the
 * apparatus at the foot.
 *
 * This is noma's generated GHG Statement report, scoped to registry data
 * reconciliation. It does not replace separate methodology, evidence, or
 * verification records. The scope line under the title says so and must not
 * be softened.
 *
 * Design tokens and the shared chrome (page frame, masthead, claim band
 * frame, section heads, table frame, apparatus, footer) come from
 * ../evidence-ledger/pdf-theme, so this document and the evidence ledgers
 * cannot drift apart. `createElement` is used instead of JSX so the module
 * renders identically under Next's server bundle and a plain Node/tsx
 * verifier.
 */
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
import { MISSING_VALUE } from "@/lib/copy-utils";

// The identity column flexes; these widths preserve complete uncertainty
// labels without returning to the original five-number ledger.
const ENTRY_COL = {
  net: 76,
  beforeUncertainty: 92,
  standardDeviation: 92,
} as const;
const CELL_GAP = 6;
/** Widest apparatus key ("REPORT VERSION") at 7pt DM Mono. */
const LEGEND_KEY_WIDTH = 66;
/** Keeps the scope line under the title clear of the masthead meta column. */
const SCOPE_MAX_WIDTH = 300;

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

/**
 * The one sentence that keeps this document honest about what it is. A
 * verifier reading only the totals must not take it for the methodology
 * report the Isometric Standard requires alongside a GHG Statement.
 */
const SCOPE_NOTE =
  "Registry data reconciliation only. This summary restates the figures Isometric already holds for this GHG Statement, and does not cover methodology or verification.";

const styles = {
  ...theme,
  ...StyleSheet.create({
    // No eyebrow above the title, so the title carries the masthead's own
    // top margin instead of inheriting the eyebrow's.
    title: { ...theme.title, marginTop: 12 },

    scope: {
      fontSize: 8,
      color: C.ink70,
      lineHeight: 1.45,
      marginTop: 8,
      maxWidth: SCOPE_MAX_WIDTH,
    },

    // Totals band body. The net cell is inverted and wider than the two fact
    // cells beside it: one result, then the operands behind it.
    bandRow: { flexDirection: "row" },
    netCell: {
      flexBasis: 0,
      flexGrow: 1.5,
      backgroundColor: C.ink,
      paddingVertical: 12,
      paddingHorizontal: 12,
    },
    netLabel: {
      fontFamily: MONO,
      fontSize: 8,
      color: C.ink25,
      letterSpacing: 1.1,
      textTransform: "uppercase",
    },
    netValue: {
      fontFamily: MONO,
      fontWeight: 500,
      fontSize: 22,
      color: C.paper,
      marginTop: 4,
      letterSpacing: -0.4,
    },
    netUnit: { fontFamily: MONO, fontSize: 8, color: C.plumSoft, marginTop: 3 },
    factCell: {
      flexBasis: 0,
      flexGrow: 1,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderLeftWidth: 1,
      borderLeftColor: C.ink12,
    },
    fact: { marginBottom: 9 },
    factLast: { marginBottom: 0 },
    factLabel: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.ink55,
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    factValue: { fontFamily: MONO, fontWeight: 500, fontSize: 11, marginTop: 2 },

    // Entry table body. Allocation remains summarized above; the ledger keeps
    // the uncertainty inputs a verifier needs beside each entry result.
    entryId: {
      fontFamily: MONO,
      fontSize: 8,
      color: C.plum,
      marginBottom: 3,
    },
    entryPeriod: {
      fontFamily: MONO,
      fontSize: 7,
      color: C.ink55,
      lineHeight: 1.45,
    },
    entryQty: { ...theme.qty, fontSize: 8 },
    // Apparatus keys are one word plus one ("REPORT VERSION").
    legendKey: { ...theme.legendKey, width: LEGEND_KEY_WIDTH },

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
  if (value === null) return MISSING_VALUE.notAvailable;
  const [whole, fraction] = Math.abs(value)
    .toFixed(KG_DECIMAL_PLACES)
    .split(".");
  const grouped = whole.replace(THOUSANDS_GROUPING, ",");
  return `${value < 0 ? "-" : ""}${grouped}.${fraction}`;
};

const formatPreparedAt = (preparedAt: Date): string =>
  `${preparedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;

const formatEntryCount = (count: number): string =>
  `${count} GHG ${count === 1 ? "Entry" : "Entries"}`;

function basisNote(model: GhgStatementReportModel): string {
  const entryTotal = formatKg(model.totals.entryNetRemovedKg);
  const statementTotal = formatKg(model.totals.statementNetRemovedKg);
  const reconciliation =
    entryTotal === statementTotal
      ? "Their net values sum to the Isometric statement total shown above."
      : `Their net values sum to ${entryTotal} kg CO2e. Isometric reports ${statementTotal} kg CO2e at statement precision.`;
  return `Every GHG Entry on this GHG Statement is listed above, and nothing else. ${reconciliation} The uncertainty discount is the before uncertainty total less the entry net total.`;
}

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

function sectionHeading(title: string, note?: string): ReactElement {
  return v(styles.sectionHead, { minPresenceAhead: 55 },
    v([styles.rule, { backgroundColor: C.plum }], {}),
    t(styles.sectionName, title),
    note ? t(styles.sectionEqn, note) : null,
  );
}

function section(
  title: string,
  children: ReactElement | ReactElement[],
  note?: string,
): ReactElement {
  return v(styles.section, {}, sectionHeading(title, note), ...(Array.isArray(children) ? children : [children]));
}

function mastheadPair(label: string, value: string): ReactElement {
  return v(styles.metaPair, {},
    t(styles.metaLabel, label),
    t(styles.metaVal, value),
  );
}

function fact(label: string, value: string, isLast = false): ReactElement {
  return v([styles.fact, isLast && styles.factLast], {},
    t(styles.factLabel, label),
    t(styles.factValue, value),
  );
}

function legendRow(key: string, description: string): ReactElement {
  return v(styles.legendRow, {},
    t(styles.legendKey, key),
    t(styles.legendDesc, description),
  );
}

function entryTableHeader(): ReactElement {
  const numericHeader = (label: string, width: number) =>
    t(
      [styles.thText, { width, textAlign: "right", paddingLeft: CELL_GAP }],
      label,
    );
  // `fixed` repeats the header on every page the table wraps onto, so a
  // continuation page is never a column of unlabelled numbers.
  return v(styles.th, { fixed: true },
    t([styles.thText, { flex: 1 }], "GHG Entry and activity dates"),
    numericHeader("Net\nremoved", ENTRY_COL.net),
    numericHeader("Before\nuncertainty", ENTRY_COL.beforeUncertainty),
    numericHeader("Standard\ndeviation", ENTRY_COL.standardDeviation),
  );
}

function entryRow(
  entry: GhgStatementReportEntry,
  isLast: boolean,
): ReactElement {
  return v([styles.tr, isLast && styles.trLast], { wrap: false },
    v({ flex: 1, paddingRight: 8 }, {},
      t(styles.entryId, entry.externalEntryId),
      t(styles.entryPeriod, `${entry.startedOn} to ${entry.completedOn}`),
    ),
    t(
      [styles.entryQty, { width: ENTRY_COL.net, paddingLeft: CELL_GAP }],
      formatKg(entry.netRemovedKg),
    ),
    t(
      [
        styles.entryQty,
        { width: ENTRY_COL.beforeUncertainty, paddingLeft: CELL_GAP },
      ],
      formatKg(entry.netRemovedWithoutDiscountKg),
    ),
    t(
      [
        styles.entryQty,
        { width: ENTRY_COL.standardDeviation, paddingLeft: CELL_GAP },
      ],
      formatKg(entry.netRemovedStandardDeviationKg),
    ),
  );
}

function buildDocument(model: GhgStatementReportModel): ReactElement {
  const control = model.documentControl;
  const preparedAt = pinnedTimestamp(model.preparedAt);
  const masthead = v(styles.masthead, {},
    v({ flex: 1, paddingRight: 16 }, {},
      v(styles.wordmarkRow, {},
        t(styles.wordmark, "noma"),
        t(styles.wordmarkSub, "DMRV | GHG STATEMENT"),
      ),
      h(Text, { style: styles.title }, "GHG Statement Data Summary"),
      t(styles.scope, SCOPE_NOTE),
    ),
    v(styles.metaCol, {},
      mastheadPair("Supplier", control.organizationName),
      mastheadPair("Facility", control.facilityCode),
      mastheadPair("Registry project", control.externalProjectId),
      mastheadPair("GHG Statement", control.externalGhgStatementId),
    ),
  );
  const totals = v(styles.claim, {},
    v(styles.claimHead, {},
      t(styles.claimHeadLabel, "GHG Statement summary"),
      t(
        styles.claimHeadEq,
        `All values kg CO2e | Reporting period ${control.reportingPeriodStartOn} to ${control.reportingPeriodEndOn}`,
      ),
    ),
    v(styles.bandRow, {},
      v(styles.netCell, {},
        t(styles.netLabel, "Statement net removed"),
        t(styles.netValue, formatKg(model.totals.statementNetRemovedKg)),
        t(
          styles.netUnit,
          `kg CO2e across ${formatEntryCount(model.entries.length)}`,
        ),
      ),
      v(styles.factCell, {},
        fact("Entry net removed", formatKg(model.totals.entryNetRemovedKg)),
        fact(
          "Entry before uncertainty",
          formatKg(model.totals.entryNetRemovedWithoutDiscountKg),
        ),
        fact(
          "Entry uncertainty discount",
          formatKg(model.totals.entryUncertaintyDiscountKg),
          true,
        ),
      ),
      v(styles.factCell, {},
        fact("Supplier allocation", formatKg(model.totals.supplierCreditKg)),
        fact("Buffer pool", formatKg(model.totals.bufferPoolKg), true),
      ),
    ),
  );
  const lastEntryIndex = model.entries.length - 1;
  const membership = section(
    "GHG Entries",
    v(styles.table, {},
      entryTableHeader(),
      ...model.entries.map((entry, index) =>
        entryRow(entry, index === lastEntryIndex),
      ),
    ),
    "All values kg CO2e",
  );
  const apparatus = v(styles.apparatus, { wrap: false },
    v(styles.noteCol, {},
      t(styles.noteH, "Basis"),
      t(styles.noteBody, basisNote(model)),
    ),
    v(styles.legendCol, {},
      legendRow("Prepared", formatPreparedAt(preparedAt)),
      legendRow("Report version", String(model.reportVersion)),
      legendRow("Standard", `Isometric ${control.standardVersion}`),
      legendRow("Protocol", `Biochar ${control.protocolVersion}`),
      control.configuredProtocolVersion
        ? legendRow("Project", `Protocol ${control.configuredProtocolVersion}`)
        : null,
    ),
  );
  const footer = v(styles.footer, { fixed: true },
    t(
      styles.footerHash,
      `NOMA DMRV | REPORT V${model.reportVersion} | SOURCE FINGERPRINT ${model.sourceFingerprint}`,
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
      membership,
      apparatus,
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
