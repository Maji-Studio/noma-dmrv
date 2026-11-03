// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/hooks/use-certification-sources", () => ({ useCandidateDocumentsForRemoval: () => ({ data: undefined }) }));

import { SharedSourceFileNotes } from "./shared-source-file-notices";
import { sharedSourceFiles, type SharedSourceFilesInput } from "./shared-source-files-model";

const FILE = "DEC_Fusinite_Results_2026-08-17_Summary.pdf";
const FACILITY = "fac-1";

function candidate(overrides: {
  id: string;
  checksum?: string | null;
  fileName?: string;
  entity: { entityType: string; entityId: string; entityLabel: string };
  binding?: { nomaRole: string; intendedTarget?: unknown; carriedEntry?: { creditBatchCode: string; occurredOn: string } } | null;
  biocharApplicationId?: string | null;
  includedInSubmission?: boolean;
}): SharedSourceFilesInput["candidates"][number] {
  return {
    document: { id: overrides.id, fileName: overrides.fileName ?? FILE, checksumSha256: overrides.checksum === undefined ? "abc" : overrides.checksum, storageKey: null },
    lineageEntity: overrides.entity,
    binding: overrides.binding ?? null,
    biocharApplicationId: overrides.biocharApplicationId ?? null,
    includedInSubmission: overrides.includedInSubmission,
  } as unknown as SharedSourceFilesInput["candidates"][number];
}

const labReport = (id: string, code: string) => candidate({
  id,
  entity: { entityType: "sample", entityId: `s-${code}`, entityLabel: `Sample ${code}` },
  binding: { nomaRole: "lab_report" },
});
const travelEntry = candidate({
  id: "d-travel",
  entity: { entityType: "emission_entry", entityId: "entry-travel", entityLabel: "Emissions entry, Staff travel" },
  binding: { nomaRole: "emission_entry", intendedTarget: { kind: "explicit", componentId: "c-travel", inputKey: "distance" } },
});

const input = (candidates: SharedSourceFilesInput["candidates"]): SharedSourceFilesInput => ({
  candidates,
  facilityId: FACILITY,
  batches: [{ id: "batch-3", code: "CB-26-003" }],
  carriedEntries: [
    { entryId: "entry-d-known", creditBatchId: "batch-3", creditBatchCode: "CB-26-003", componentId: "c-travel", componentName: "Staff travel" },
    { entryId: "entry-d-other", creditBatchId: "batch-1", creditBatchCode: "CB-26-001", componentId: "c-travel", componentName: "Staff travel" },
  ],
  linesByBatchId: {
    "batch-3": [{ componentId: "c-travel", displayName: "Staff travel", entries: [{ id: "entry-travel" }] }] as never,
  },
});

afterEach(cleanup);

const renderNotes = (files: Parameters<typeof SharedSourceFileNotes>[0]["files"]) =>
  render(<div role="status"><SharedSourceFileNotes files={files} /></div>);

describe("SharedSourceFileNotes", () => {
  it("shows the file, the count and a link per record when one file backs different kinds", () => {
    renderNotes(sharedSourceFiles(input([labReport("d1", "SAM-26-007"), labReport("d2", "SAM-26-008"), travelEntry])));

    const note = screen.getByRole("status");
    expect(note.textContent).toContain(`${FILE} is the file for 2 different kinds of evidence.`);
    const items = within(note).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Lab report:SAM-26-007SAM-26-008",
      "Staff travel:CB-26-003",
    ]);
    expect(within(items[0]).getByRole("link", { name: "SAM-26-007" }).getAttribute("href")).toBe(`/lab-samples?facility=${FACILITY}&sample=s-SAM-26-007`);
    expect(within(items[1]).getByRole("link", { name: "CB-26-003" }).getAttribute("href")).toBe(`/credit-batches/batch-3?facility=${FACILITY}&tab=emissions`);
  });

  it("links a carried emissions entry to its own credit batch", () => {
    const entry = (id: string, code: string) => candidate({
      id,
      entity: { entityType: "emission_entry", entityId: `entry-${id}`, entityLabel: `Emissions entry, Staff travel, 2026-08-03, ${code}` },
      binding: { nomaRole: "emission_entry", carriedEntry: { creditBatchCode: code, occurredOn: "2026-08-03" }, intendedTarget: { kind: "explicit", componentId: "c-travel", inputKey: "distance" } },
    });
    renderNotes(sharedSourceFiles(input([labReport("d1", "SAM-26-007"), entry("d-known", "CB-26-003"), entry("d-other", "CB-26-001")])));

    const item = within(screen.getByRole("status")).getAllByRole("listitem")[1];
    expect(item.textContent).toBe("Staff travel:CB-26-001CB-26-003");
    expect(within(item).getByRole("link", { name: "CB-26-003" }).getAttribute("href")).toBe(`/credit-batches/batch-3?facility=${FACILITY}&tab=emissions`);
    expect(within(item).getByRole("link", { name: "CB-26-001" }).getAttribute("href")).toBe(`/credit-batches/batch-1?facility=${FACILITY}&tab=emissions`);
  });

  it("shows nothing when the file is reused within one kind", () => {
    const { container } = render(<SharedSourceFileNotes files={sharedSourceFiles(input([labReport("d1", "SAM-26-007"), labReport("d2", "SAM-26-008")]))} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows nothing for different files, or for a file the saved attempt leaves out", () => {
    const otherBytes = candidate({ ...travelEntry, id: "d-travel", checksum: "other", entity: travelEntry.lineageEntity, binding: travelEntry.binding as never });
    const excluded = { ...travelEntry, includedInSubmission: false };
    const { container } = render(<SharedSourceFileNotes files={[
      ...sharedSourceFiles(input([labReport("d1", "SAM-26-007"), otherBytes])),
      ...sharedSourceFiles(input([labReport("d1", "SAM-26-007"), excluded])),
    ]} />);
    expect(container.innerHTML).toBe("");
  });
});
