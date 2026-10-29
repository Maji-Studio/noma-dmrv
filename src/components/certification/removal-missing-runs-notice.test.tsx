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

  it("does not promise a member an admin can add a run Edit would refuse", () => {
    render(<RemovalMissingRunsNotice facilityId="facility-1" canManage={false} batches={[
      { creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true }, { id: "run-2", code: "RUN-2", canAdd: false }] },
    ]} />);
    expect(document.body.textContent).toContain("Their emissions are not counted.");
    expect(document.body.textContent).not.toContain("An admin can add");
  });

  it("shows nothing when no batch is missing a run", () => {
    const { container } = render(<RemovalMissingRunsNotice facilityId="facility-1" canManage batches={[]} />);
    expect(container.textContent).toBe("");
  });
});
