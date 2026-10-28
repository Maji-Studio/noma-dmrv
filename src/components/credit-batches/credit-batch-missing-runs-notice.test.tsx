// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MISSING_PRODUCTION_RUN_ITEM_PREFIX } from "@/lib/credit-batches/open-items";
import { CreditBatchMissingRunsNotice, missingRunsFromTodos } from "./credit-batch-missing-runs-notice";

afterEach(cleanup);

const RUNS = [{ id: "run-1", code: "RUN-1" }, { id: "run-2", code: "RUN-2" }];

describe("missingRunsFromTodos", () => {
  it("keeps only the missing-run Checks that name their run", () => {
    expect(missingRunsFromTodos([
      { id: `${MISSING_PRODUCTION_RUN_ITEM_PREFIX}run-1`, productionRun: RUNS[0] },
      { id: "late-production-run:run-2", productionRun: RUNS[1] },
      { id: "document:lab-report" },
    ])).toEqual([RUNS[0]]);
    expect(missingRunsFromTodos(undefined)).toEqual([]);
  });
});

describe("CreditBatchMissingRunsNotice", () => {
  it("names one run with a link and a way into Edit", () => {
    const onEdit = vi.fn();
    render(<CreditBatchMissingRunsNotice runs={[RUNS[0]]} facilityId="facility-1" canManage onEdit={onEdit} />);
    expect(screen.getByText("1 completed run is not in this credit batch yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "RUN-1" }).getAttribute("href")).toContain("run-1");
    expect(screen.getByRole("status").textContent).toContain("Its emissions are not counted.");
    fireEvent.click(screen.getByRole("button", { name: "Add in Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it("counts several runs and offers no Edit when the viewer cannot edit", () => {
    render(<CreditBatchMissingRunsNotice runs={RUNS} facilityId="facility-1" canManage={false} />);
    expect(screen.getByText("2 completed runs are not in this credit batch yet")).toBeTruthy();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["RUN-1", "RUN-2"]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("An admin can add them in Edit.");
  });

  it("shows nothing without missing runs", () => {
    const { container } = render(<CreditBatchMissingRunsNotice runs={[]} facilityId="facility-1" canManage />);
    expect(container.textContent).toBe("");
  });
});
