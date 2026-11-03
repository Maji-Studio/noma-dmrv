import { describe, expect, it } from "vitest";
import { findSharedSourceFiles, type SourceFileUse } from "./shared-source-files";

const LAB = "DEC_Fusinite_Results_2026-08-17_Summary.pdf";

function fileUse(overrides: Partial<SourceFileUse> & Pick<SourceFileUse, "role" | "record">): SourceFileUse {
  return { fileKey: "sha-lab", fileName: LAB, ...overrides };
}

const sample7 = fileUse({ role: "lab_report", record: { label: "Sample SAM-26-007", href: "/lab-samples?sample=s7" } });
const sample8 = fileUse({ role: "lab_report", record: { label: "Sample SAM-26-008", href: "/lab-samples?sample=s8" } });
const staffTravel = fileUse({
  role: "emission_entry",
  component: { id: "c-travel", name: "Staff travel" },
  record: { label: "CB-26-003", href: "/credit-batches/b3?tab=emissions" },
});
const diesel = fileUse({
  role: "emission_entry",
  component: { id: "c-diesel", name: "Generator diesel" },
  record: { label: "CB-26-003", href: "/credit-batches/b3?tab=emissions" },
});

describe("findSharedSourceFiles", () => {
  it("gives no note when a lab report covers several samples", () => {
    expect(findSharedSourceFiles([sample7, sample8])).toEqual([]);
  });

  it("gives no note when one bill of lading covers several deliveries", () => {
    const bol = (code: string) => fileUse({ fileKey: "sha-bol", fileName: "bol.pdf", role: "delivery_bill_of_lading", record: { label: `Delivery ${code}`, href: null } });
    expect(findSharedSourceFiles([bol("DL-26-019"), bol("DL-26-020"), bol("DL-26-021")])).toEqual([]);
  });

  it("treats application logbooks and application evidence as one kind", () => {
    const logbook = fileUse({ fileKey: "sha-app", fileName: "app.pdf", role: "inventory", record: { label: "Application AP-26-019", href: null } });
    const photo = fileUse({ fileKey: "sha-app", fileName: "app.pdf", role: "application_evidence", record: { label: "Application AP-26-020", href: null } });
    expect(findSharedSourceFiles([logbook, photo])).toEqual([]);
  });

  it("gives no note when one invoice covers several entries of one emission component", () => {
    const other = { ...staffTravel, record: { label: "CB-26-004", href: "/credit-batches/b4?tab=emissions" } };
    expect(findSharedSourceFiles([staffTravel, other])).toEqual([]);
  });

  it("gives one note per file used across kinds, with the distinct kinds in a stable order", () => {
    const bol = fileUse({ role: "delivery_bill_of_lading", record: { label: "Delivery DL-26-019", href: null } });
    const forward = [staffTravel, sample8, diesel, bol, sample7, staffTravel];
    const notes = findSharedSourceFiles(forward);
    expect(notes).toEqual([
      {
        fileKey: "sha-lab",
        fileName: LAB,
        kinds: [
          { key: "lab-report", label: "Lab report", records: [sample7.record, sample8.record] },
          { key: "delivery-bill-of-lading", label: "Delivery bill of lading", records: [bol.record] },
          { key: "emission-component:c-diesel", label: "Generator diesel", records: [diesel.record] },
          { key: "emission-component:c-travel", label: "Staff travel", records: [staffTravel.record] },
        ],
      },
    ]);
    expect(findSharedSourceFiles([...forward].reverse())).toEqual(notes);
  });

  it("keeps files apart by their key and orders notes by file name", () => {
    const other = (overrides: Partial<SourceFileUse>) => fileUse({ fileKey: "sha-a", fileName: "A.pdf", role: "lab_report", record: sample7.record, ...overrides });
    const notes = findSharedSourceFiles([
      staffTravel, sample7,
      other({}), other({ role: "feedstock_bill_of_lading", record: { label: "Feedstock FS-26-001", href: null } }),
      // Same name, other bytes: a separate file that is used for one kind only.
      fileUse({ fileKey: "sha-other", role: "durability_evidence_ledger", record: { label: "Credit batch CB-26-003", href: null } }),
    ]);
    expect(notes.map((note) => [note.fileName, note.kinds.map((kind) => kind.label)])).toEqual([
      ["A.pdf", ["Lab report", "Feedstock bill of lading"]],
      [LAB, ["Lab report", "Staff travel"]],
    ]);
  });

  it("names an emission component without a name as an emissions entry", () => {
    const unnamed = { ...staffTravel, component: { id: "c-x", name: null } };
    expect(findSharedSourceFiles([sample7, unnamed])[0]?.kinds.map((kind) => kind.label)).toEqual(["Lab report", "Emissions entry"]);
  });
});
