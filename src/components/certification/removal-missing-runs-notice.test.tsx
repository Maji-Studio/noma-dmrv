// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RemovalMissingRunsNotice } from "./removal-missing-runs-notice";

afterEach(cleanup);

describe("RemovalMissingRunsNotice", () => {
  it("names each batch's missing runs and links the batch", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true }] },
      { creditBatchId: "batch-2", creditBatchCode: "CB-2", runs: [{ id: "run-2", code: "RUN-2", canAdd: true }, { id: "run-3", code: "RUN-3", canAdd: true }] },
    ]} />);
    expect(screen.getByText("1 completed run is not in CB-1 yet")).toBeTruthy();
    expect(screen.getByText("2 completed runs are not in CB-2 yet")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open credit batch" }).map((link) => link.getAttribute("href")))
      .toEqual([expect.stringContaining("batch-1"), expect.stringContaining("batch-2")]);
    expect(screen.getByRole("link", { name: "RUN-3" })).toBeTruthy();
    expect(document.body.textContent).toContain("Their emissions are not counted.");
    expect(document.body.textContent).not.toContain("in Edit");
  });

  it("tells a member who can add the run", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage={false} batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true }] },
    ]} />);
    expect(document.body.textContent).toContain("An admin can add it in Edit.");
    expect(document.body.textContent).not.toContain("Open the credit batch and add");
  });

  it("tells a member which addable runs an admin can add in a mixed batch", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage={false} batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true }, { id: "run-2", code: "RUN-2", canAdd: false }] },
    ]} />);
    expect(document.body.textContent).toContain("RUN-2 cannot be added.");
    expect(document.body.textContent).toContain("An admin can add RUN-1 in Edit.");
    expect(document.body.textContent).not.toContain("RUN-1 cannot be added");
  });

  it("does not promise a member an admin can add when every run is refused", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage={false} batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: false }] },
    ]} />);
    expect(document.body.textContent).not.toContain("An admin can add");
  });

  it.each([true, false])("says a lone refused run's code once and links the Emissions tab (canManage %s)", (canManage) => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage={canManage} batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: false }] },
    ]} />);
    const text = document.body.textContent!;
    expect(text).toContain(
      "RUN-1. Its emissions are not counted. It cannot be added. Record its diesel and power on the credit batch's Emissions tab.",
    );
    expect(text.match(/RUN-1/g)).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Open credit batch" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Emissions" }).getAttribute("href"))
      .toBe("/credit-batches/batch-1?facility=facility-1&tab=emissions");
  });

  it("offers both the batch and its Emissions tab in a mixed batch", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true }, { id: "run-2", code: "RUN-2", canAdd: false }] },
    ]} />);
    expect(document.body.textContent).toContain("RUN-2 cannot be added.");
    expect(document.body.textContent).not.toContain("RUN-1 cannot be added");
    expect(screen.getByRole("link", { name: "Open credit batch" }).getAttribute("href")).toBe("/credit-batches/batch-1?facility=facility-1");
    expect(screen.getByRole("link", { name: "Open Emissions" })).toBeTruthy();
  });

  it("warns an admin about a same-day Emissions entry on a held run", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true, sameDayEntryDate: "2026-09-09" }] },
    ]} />);
    expect(document.body.textContent).toContain("If an Emissions entry already records its emissions, delete it when you add the run.");
  });

  it("names the addable run and its day when a refused run is in the batch", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [
        { id: "run-1", code: "RUN-1", canAdd: true, sameDayEntryDate: "2026-09-09" },
        { id: "run-2", code: "RUN-2", canAdd: false },
      ] },
    ]} />);
    const text = document.body.textContent!;
    expect(text).toContain("RUN-2 cannot be added.");
    expect(text).toContain("If the Emissions entry dated Sep 9, 2026 already records the emissions of RUN-1, delete it when you add the run.");
    expect(text).not.toContain("records its emissions");
  });

  it("keeps the same-day warning from a member and from runs without an entry", () => {
    const batches = [{ creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true, sameDayEntryDate: "2026-09-09" }] }];
    const { unmount } = render(<RemovalMissingRunsNotice facilityId="facility-1" canManage={false} batches={batches} />);
    expect(document.body.textContent).not.toContain("delete it");
    unmount();
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage batches={[{ ...batches[0], runs: [{ id: "run-1", code: "RUN-1", canAdd: true }] }]} />);
    expect(document.body.textContent).not.toContain("delete it");
  });

  it("shows nothing when no batch is missing a run", () => {
    const { container } = render(<RemovalMissingRunsNotice facilityId="facility-1" canManage batches={[]} />);
    expect(container.textContent).toBe("");
  });
});
