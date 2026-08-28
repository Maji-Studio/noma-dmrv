import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  canonicalizePdfBytes,
  NonCanonicalPdfError,
  subsetTag,
} from "./canonical-pdf";
import {
  buildGhgStatementReportModel,
  GhgStatementReportReconciliationError,
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
/** Comfortably more entry rows than one A4 page of the table can hold. */
const MULTI_PAGE_ENTRY_COUNT = 40;
const XREF_KEYWORD = "xref";
/** Tail of a classic in-use xref entry: `<10 offset digits> 00000 n \n`. */
const IN_USE_ENTRY_TAIL = " 00000 n \n";
const CHILD_RENDER_TIMEOUT_MS = 120_000;
const RENDERER_PATH = fileURLToPath(new URL("./pdf.ts", import.meta.url));
const TSX_BIN = resolve(process.cwd(), "node_modules/.bin/tsx");
/**
 * Renders one serialized model and prints its checksum. Kept as a script run
 * by a fresh Node process: an in-process second render shares the registered
 * font state, the module caches and any process-level seed, so it cannot see
 * drift that only differs between processes.
 */
const CHILD_SCRIPT = `
import { createHash } from "node:crypto";
import { renderGhgStatementReportPdf } from ${JSON.stringify(RENDERER_PATH)};
async function main() {
  const bytes = await renderGhgStatementReportPdf(JSON.parse(process.argv[2]));
  process.stdout.write(createHash("sha256").update(bytes).digest("hex"));
}
void main();
`;

/** SHA-256 of the model rendered in a brand new Node process. */
function renderChecksumInFreshProcess(
  scriptPath: string,
  model: GhgStatementReportModel,
): string {
  return execFileSync(TSX_BIN, [scriptPath, JSON.stringify(model)], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: CHILD_RENDER_TIMEOUT_MS,
  }).trim();
}

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
      configuredProtocolVersion: "1.1",
    },
    authoritativeStatement: {
      externalEntryIds: ["rmv_1"],
      pendingTotalCo2eRemovedKg: 900,
      creditAllocation: {
        supplierCreditKg: 880,
        bufferPoolKg: 20,
      },
    },
    remoteEntries: [
      {
        id: "rmv_1",
        startedOn: "2026-07-01",
        completedOn: "2026-07-31",
        netRemovedKg: 900,
        netRemovedWithoutDiscountKg: 950,
        netRemovedStandardDeviationKg: 4,
        ghgStatementId: "ggs_1",
      },
    ],
    ...overrides,
  });
}

/** Text of each page, in page order, with runs of whitespace collapsed. */
async function pageTexts(bytes: Buffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await task.promise;
  try {
    return await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, index) => {
        const page = await pdf.getPage(index + 1);
        const content = await page.getTextContent();
        return content.items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" ")
          .replace(/\s+/g, " ");
      }),
    );
  } finally {
    await task.destroy();
  }
}

describe("renderGhgStatementReportPdf", () => {
  it("renders a readable fact-only GHG Statement summary", async () => {
    const model = buildModel();

    const bytes = await renderGhgStatementReportPdf(model);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.subarray(-6).toString()).toContain("%%EOF");
    expect(bytes.byteLength).toBeGreaterThan(8_000);

    {
      const text = (await pageTexts(bytes)).join(" ");

      expect(text).toContain("GHG Statement Data Summary");
      expect(text).toContain("prj_1");
      expect(text).toContain("ggs_1");
      expect(text).toContain("rmv_1");
      expect(text).toContain("2026-07-01 to 2026-07-31");
      // Registry-calculated facts: the authoritative statement total, both
      // uncertainty operands, and the credit split.
      expect(text).toContain("900.000");
      expect(text).toContain("950.000");
      expect(text).toContain("880.000");
      expect(text).toContain("20.000");
      expect(text).toContain("across 1 GHG Entry");
      // Traceability stays on the page, quietly, in the footer.
      expect(text).toContain(model.sourceFingerprint);
      // The pinned versions moved out of the body and into the apparatus.
      expect(text).toContain("Isometric 1.7");
      expect(text).toContain("Biochar 1.1.1");
      // The scope note defines what this generated GHG Statement report covers.
      expect(text).toContain("Registry data reconciliation only");
      expect(text).toContain("does not cover methodology or verification");
      // Internal report plumbing the verifier cannot act on stays off the page.
      // Uppercase, letter-spaced headings extract as "D O C U M E N T", so
      // absence is asserted against the squashed lowercase text.
      const squashed = text.toLowerCase().replace(/\s+/g, "");
      expect(squashed).not.toContain("notconfigured");
      expect(squashed).not.toContain("reportmodel");
      expect(squashed).not.toContain("documentcontrol");
      expect(squashed).not.toContain("methodologyandreviewednarrative");
      expect(squashed).not.toContain("reviewacknowledgment");
      expect(squashed).not.toContain("humanreviewed");
      expect(squashed).toContain("entryuncertaintydiscount50.000");
      expect(squashed).toContain("projectprotocol1.1");
    }
  });

  it("uses the authoritative statement total and explains entry precision", async () => {
    const model = buildModel({
      authoritativeStatement: {
        externalEntryIds: ["rmv_1"],
        pendingTotalCo2eRemovedKg: 1_500,
        creditAllocation: {
          supplierCreditKg: 1_450,
          bufferPoolKg: 50,
        },
      },
      remoteEntries: [
        {
          id: "rmv_1",
          startedOn: "2026-07-01",
          completedOn: "2026-07-31",
          netRemovedKg: 1_502.1608971810922,
          netRemovedWithoutDiscountKg: 1_527.153951802095,
          netRemovedStandardDeviationKg: 24.99305462100288,
          ghgStatementId: "ggs_1",
        },
      ],
    });

    const text = (await pageTexts(await renderGhgStatementReportPdf(model))).join(
      " ",
    );
    const squashed = text.toLowerCase().replace(/\s+/g, "");

    expect(squashed).toContain("statementnetremoved1,500.000");
    expect(squashed).toContain("entrynetremoved1,502.161");
    expect(squashed).toContain("supplierallocation1,450.000");
    expect(squashed).toContain("bufferpool50.000");
    expect(text).toContain("Their net values sum to 1,502.161 kg CO2e");
    expect(text).toContain(
      "Isometric reports 1,500.000 kg CO2e at statement precision",
    );
  });

  it("repeats the entry table header when the entries spill onto a second page", async () => {
    const entries = Array.from({ length: MULTI_PAGE_ENTRY_COUNT }, (_, index) => ({
      // Zero-padded so the ids sort the same way the model sorts them.
      id: `rmv_${String(index + 1).padStart(3, "0")}`,
      startedOn: "2026-07-01",
      completedOn: "2026-07-31",
      netRemovedKg: 900,
      netRemovedWithoutDiscountKg: 950,
      netRemovedStandardDeviationKg: 4,
      supplierCreditKg: 880,
      bufferPoolKg: 20,
      ghgStatementId: "ggs_1",
    }));
    const model = buildModel({
      authoritativeStatement: {
        externalEntryIds: entries.map((entry) => entry.id),
        pendingTotalCo2eRemovedKg: 900 * MULTI_PAGE_ENTRY_COUNT,
        creditAllocation: {
          supplierCreditKg: 880 * MULTI_PAGE_ENTRY_COUNT,
          bufferPoolKg: 20 * MULTI_PAGE_ENTRY_COUNT,
        },
      },
      remoteEntries: entries,
    });

    const pages = await pageTexts(await renderGhgStatementReportPdf(model));

    expect(pages.length).toBeGreaterThan(1);
    // Every entry keeps its row, wherever it lands.
    const all = pages.join(" ");
    for (const entry of entries) expect(all).toContain(entry.id);
    // A continuation page must carry the complete header before its first row.
    for (const page of pages.slice(1)) {
      const squashed = page.toLowerCase().replace(/\s+/g, "");
      const firstEntry = squashed.indexOf("rmv_");
      const identityHeader = squashed.indexOf("ghgentryandreportingperiod");
      const netHeader = squashed.indexOf("netremoved");
      const uncertaintyHeader = squashed.indexOf("beforeuncertainty");
      const deviationHeader = squashed.indexOf("standarddeviation");

      expect(firstEntry).toBeGreaterThanOrEqual(0);
      for (const header of [
        identityHeader,
        netHeader,
        uncertaintyHeader,
        deviationHeader,
      ]) {
        expect(header).toBeGreaterThanOrEqual(0);
        expect(header).toBeLessThan(firstEntry);
      }
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

  it(
    "produces identical bytes in two fresh processes",
    async () => {
      const model = buildModel();
      const directory = mkdtempSync(join(tmpdir(), "ghg-report-determinism-"));
      const scriptPath = join(directory, "render-checksum.ts");
      writeFileSync(scriptPath, CHILD_SCRIPT);

      try {
        const first = renderChecksumInFreshProcess(scriptPath, model);
        const second = renderChecksumInFreshProcess(scriptPath, model);

        expect(second).toBe(first);
        expect(first).toBe(sha256Hex(await renderGhgStatementReportPdf(model)));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    CHILD_RENDER_TIMEOUT_MS,
  );

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

  it("refuses to canonicalize a non-zero xref generation", async () => {
    const bytes = await renderGhgStatementReportPdf(buildModel());
    const text = bytes.toString("latin1");
    const tableStart = text.lastIndexOf(`\n${XREF_KEYWORD}\n`);
    const entryAt = text.indexOf(IN_USE_ENTRY_TAIL, tableStart);
    expect(entryAt).toBeGreaterThan(tableStart);

    // Same byte length, one legal-but-unsupported generation number: the
    // rebuilt table would renumber it to 0 while the object header kept the
    // original generation, so it has to throw instead.
    const mutated = Buffer.from(
      text.slice(0, entryAt) +
        IN_USE_ENTRY_TAIL.replace("00000", "00001") +
        text.slice(entryAt + IN_USE_ENTRY_TAIL.length),
      "latin1",
    );
    expect(mutated.byteLength).toBe(bytes.byteLength);

    expect(() => canonicalizePdfBytes(mutated)).toThrow(NonCanonicalPdfError);
  });

  it("rejects an unparseable preparedAt instead of stamping a fallback", () => {
    // Metadata pinned to the epoch while the page printed the raw string put
    // two preparation times into one checksummed artifact. The model builder
    // now fails closed, so the renderer never sees such a model.
    expect(() => buildModel({ preparedAt: "not-a-timestamp" })).toThrow(
      GhgStatementReportReconciliationError,
    );
  });
});
