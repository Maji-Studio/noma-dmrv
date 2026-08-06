import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  canonicalizePdfBytes,
  NonCanonicalPdfError,
  subsetTag,
} from "./canonical-pdf";
import {
  buildGhgStatementReportModel,
  sha256Hex,
  type BuildGhgStatementReportModelInput,
  type GhgStatementReportModel,
} from "./model";
import { renderGhgStatementReportPdf } from "./pdf";

const PREPARED_AT = "2026-07-28T12:00:00.000Z";
// Two wall-clock readings far enough apart that any clock-derived metadata
// (creation date, modification date, the PDF trailer /ID derived from them)
// would differ between renders.
const FIRST_CLOCK = new Date("2026-01-02T03:04:05.000Z");
const SECOND_CLOCK = new Date("2031-11-12T13:14:15.000Z");

function buildModel(
  overrides: Partial<BuildGhgStatementReportModelInput> = {},
): GhgStatementReportModel {
  return buildGhgStatementReportModel({
    reportVersion: 3,
    preparedAt: PREPARED_AT,
    documentControl: {
      organizationName: "Test supplier",
      facilityCode: "FAC-01",
      externalProjectId: "prj_1",
      externalGhgStatementId: "ggs_1",
      reportingPeriodStartOn: "2026-07-01",
      reportingPeriodEndOn: "2026-07-31",
      standardVersion: "1.7",
      protocolVersion: "1.1.1",
      configuredProtocolVersion: null,
    },
    authoritativeStatement: {
      externalEntryIds: ["rmv_1"],
      pendingTotalCo2eRemovedKg: 900,
    },
    remoteEntries: [
      {
        id: "rmv_1",
        startedOn: "2026-07-01",
        completedOn: "2026-07-31",
        netRemovedKg: 900,
        netRemovedWithoutDiscountKg: 950,
        netRemovedStandardDeviationKg: 4,
        supplierCreditKg: 880,
        bufferPoolKg: 20,
        ghgStatementId: "ggs_1",
      },
    ],
    ...overrides,
  });
}

describe("renderGhgStatementReportPdf", () => {
  it("renders a readable fact-only GHG Statement summary", async () => {
    const model = buildModel();

    const bytes = await renderGhgStatementReportPdf(model);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.subarray(-6).toString()).toContain("%%EOF");
    expect(bytes.byteLength).toBeGreaterThan(8_000);

    const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    const pdf = await task.promise;
    try {
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, index) => {
          const page = await pdf.getPage(index + 1);
          const content = await page.getTextContent();
          return content.items
            .flatMap((item) => ("str" in item ? [item.str] : []))
            .join(" ");
        }),
      );
      const text = pages.join(" ").replace(/\s+/g, " ");

      expect(text).toContain("GHG Statement Data Summary");
      expect(text).toContain("prj_1");
      expect(text).toContain("ggs_1");
      expect(text).toContain("rmv_1");
      expect(text).toContain("2026-07-01 to 2026-07-31");
      expect(text).toContain(model.sourceFingerprint);
      expect(text).toContain(
        "Isometric Standard 1.7; Biochar Protocol 1.1.1",
      );
      expect(text).toContain("Not configured");
      expect(text).toContain("Registry data reconciliation only");
      expect(text).not.toContain("Methodology and reviewed narrative");
      expect(text).not.toContain("Review acknowledgment");
      expect(text).not.toContain("Human reviewed");
    } finally {
      await task.destroy();
    }
  });
});

describe("renderGhgStatementReportPdf determinism", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces identical bytes for two renders of the same model", async () => {
    const model = buildModel();

    const first = await renderGhgStatementReportPdf(model);
    const second = await renderGhgStatementReportPdf(model);

    expect(sha256Hex(second)).toBe(sha256Hex(first));
    expect(second.byteLength).toBe(first.byteLength);
  });

  it("produces identical bytes when the system clock moves between renders", async () => {
    const model = buildModel();
    // Fake only Date: faking timers wholesale would stall the renderer's
    // stream callbacks.
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(FIRST_CLOCK);
    const first = await renderGhgStatementReportPdf(model);
    vi.setSystemTime(SECOND_CLOCK);
    const second = await renderGhgStatementReportPdf(model);

    expect(sha256Hex(second)).toBe(sha256Hex(first));
  });

  it("stamps document metadata from preparedAt, not the clock", async () => {
    const model = buildModel();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SECOND_CLOCK);

    const bytes = await renderGhgStatementReportPdf(model);

    const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    const pdf = await task.promise;
    try {
      const { info } = (await pdf.getMetadata()) as unknown as {
        info: Record<string, unknown>;
      };
      // PDF date strings are `D:YYYYMMDDHHmmSS…`; assert the frozen preparedAt
      // date, not the faked clock's year.
      expect(String(info.CreationDate)).toContain("D:20260728");
      expect(String(info.CreationDate)).not.toContain("2031");
      expect(info.Producer).toBe("noma dMRV GHG statement report");
      expect(info.Creator).toBe("noma dMRV");
    } finally {
      await task.destroy();
    }
  });

  it("emits already-canonical bytes", async () => {
    const bytes = await renderGhgStatementReportPdf(buildModel());

    // A second pass must be a no-op: objects are already in id order and the
    // subset tags are already the name-derived ones.
    expect(sha256Hex(canonicalizePdfBytes(bytes))).toBe(sha256Hex(bytes));
    // Font subset tags come from the PostScript name, not Math.random.
    expect(bytes.toString("latin1")).toContain(
      `/BaseFont /${subsetTag("DMSans-Bold")}+DMSans-Bold`,
    );
  });

  it("refuses to canonicalize bytes it cannot parse", () => {
    expect(() => canonicalizePdfBytes(Buffer.from("%PDF-1.3\nbroken\n"))).toThrow(
      NonCanonicalPdfError,
    );
  });

  it("falls back to a fixed timestamp when preparedAt is unparseable", async () => {
    const model = buildModel({ preparedAt: "not-a-timestamp" });
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(FIRST_CLOCK);
    const first = await renderGhgStatementReportPdf(model);
    vi.setSystemTime(SECOND_CLOCK);
    const second = await renderGhgStatementReportPdf(model);

    expect(sha256Hex(second)).toBe(sha256Hex(first));
  });
});
