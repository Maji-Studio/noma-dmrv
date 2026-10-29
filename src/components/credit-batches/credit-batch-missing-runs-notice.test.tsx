// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LATE_PRODUCTION_RUN_ITEM_PREFIX, MISSING_PRODUCTION_RUN_ITEM_PREFIX } from "@/lib/credit-batches/open-items";
import { CreditBatchLateRunsNotice, CreditBatchMissingRunsNotice, lateRunsFromTodos, missingRunsFromTodos } from "./credit-batch-missing-runs-notice";

afterEach(cleanup);

const RUNS = [{ id: "run-1", code: "RUN-1" }, { id: "run-2", code: "RUN-2" }];

describe("missingRunsFromTodos", () => {
  it("keeps only the missing-run Checks that name their run", () => {
    expect(missingRunsFromTodos([
      { id: `${MISSING_PRODUCTION_RUN_ITEM_PREFIX}run-1`, productionRun: RUNS[0] },
      { id: `${LATE_PRODUCTION_RUN_ITEM_PREFIX}run-2`, productionRun: RUNS[1] },
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
    expect(screen.getByRole("status").textContent).not.toContain("Add it in Edit.");
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

  it("tells an admin what to do when Edit is not available yet", () => {
    render(<CreditBatchMissingRunsNotice runs={RUNS} facilityId="facility-1" canManage />);
    expect(screen.getByRole("status").textContent).toContain("Their emissions are not counted. Add them in Edit.");
  });

  it("warns an admin about a same-day Emissions entry", () => {
    render(<CreditBatchMissingRunsNotice runs={[{ ...RUNS[0], sameDayEntryDate: "2026-09-09" }]} facilityId="facility-1" canManage onEdit={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Its emissions are not counted. If an Emissions entry already records its emissions, delete it when you add the run.",
    );
  });

  it("names only the runs with a same-day entry, in one sentence, when several runs are missing", () => {
    render(<CreditBatchMissingRunsNotice runs={[{ ...RUNS[0], sameDayEntryDate: "2026-09-09" }, RUNS[1]]} facilityId="facility-1" canManage onEdit={vi.fn()} />);
    const text = screen.getByRole("status").textContent!;
    expect(text).toContain("If the Emissions entry dated Sep 9, 2026 already records the emissions of RUN-1, delete it when you add the run.");
    expect(text).not.toContain("RUN-2 (");
  });

  it("lists every same-day run once with its day", () => {
    render(<CreditBatchMissingRunsNotice
      runs={[{ ...RUNS[0], sameDayEntryDate: "2026-09-09" }, { ...RUNS[1], sameDayEntryDate: "2026-09-12" }]}
      facilityId="facility-1" canManage onEdit={vi.fn()}
    />);
    const text = screen.getByRole("status").textContent!;
    expect(text).toContain("records the emissions of RUN-1 (entry dated Sep 9, 2026) or RUN-2 (entry dated Sep 12, 2026), delete it when you add the run.");
    expect(text.match(/If an Emissions entry/g)).toHaveLength(1);
  });

  it("carries the same-day date from the to-dos", () => {
    expect(missingRunsFromTodos([{ id: `${MISSING_PRODUCTION_RUN_ITEM_PREFIX}run-1`, productionRun: RUNS[0], sameDayEntryDate: "2026-09-09" }]))
      .toEqual([{ ...RUNS[0], sameDayEntryDate: "2026-09-09" }]);
  });

  it("shows nothing without missing runs", () => {
    const { container } = render(<CreditBatchMissingRunsNotice runs={[]} facilityId="facility-1" canManage />);
    expect(container.textContent).toBe("");
  });
});

const LATE = [
  { id: `${LATE_PRODUCTION_RUN_ITEM_PREFIX}run-1`, productionRun: RUNS[0], title: "RUN-1 was recorded after RM-9 was sent", titleAfterCode: " was recorded after RM-9 was sent", detail: "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Sep 10, 2026." },
  { id: `${LATE_PRODUCTION_RUN_ITEM_PREFIX}run-2`, productionRun: RUNS[1], title: "RUN-2 was recorded after RM-9 was sent", titleAfterCode: " was recorded after RM-9 was sent", detail: "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Sep 11, 2026." },
  { id: `${MISSING_PRODUCTION_RUN_ITEM_PREFIX}run-3`, productionRun: { id: "run-3", code: "RUN-3" }, title: "RUN-3 is not in this credit batch yet" },
];

describe("lateRunsFromTodos", () => {
  it("keeps only the Sent late-run Checks, with their own words", () => {
    expect(lateRunsFromTodos(LATE).map((run) => run.code)).toEqual(["RUN-1", "RUN-2"]);
    expect(lateRunsFromTodos(undefined)).toEqual([]);
  });
});

describe("CreditBatchLateRunsNotice", () => {
  it("says what the Check says, links the run and opens the Emissions tab", () => {
    render(<CreditBatchLateRunsNotice runs={lateRunsFromTodos(LATE)} creditBatchId="batch-1" facilityId="facility-1" />);
    const notices = screen.getAllByTestId("credit-batch-late-run");
    expect(notices).toHaveLength(2);
    expect(notices[0].textContent).toContain("RUN-1 was recorded after RM-9 was sent.");
    expect(notices[0].textContent).toContain("Record its diesel and power on the Emissions tab, dated Sep 10, 2026.");
    expect(screen.getByRole("link", { name: "RUN-1" }).getAttribute("href")).toContain("run-1");
    const open = screen.getAllByRole("link", { name: "Open Emissions" })[0].getAttribute("href")!;
    expect(open).toContain("/credit-batches/batch-1");
    expect(open).toContain("tab=emissions");
    expect(screen.queryByRole("button", { name: "Add in Edit" })).toBeNull();
  });

  it("links the code and keeps the rest of the title from titleAfterCode", () => {
    render(<CreditBatchLateRunsNotice
      runs={[{ ...RUNS[0], title: "RUN-1 cannot be added to this credit batch", titleAfterCode: " cannot be added to this credit batch" }]}
      creditBatchId="batch-1"
      facilityId="facility-1"
    />);
    expect(screen.getByTestId("credit-batch-late-run").textContent).toContain("RUN-1 cannot be added to this credit batch.");
    expect(screen.getByRole("link", { name: "RUN-1" })).toBeTruthy();
  });

  it("shows nothing without late runs", () => {
    const { container } = render(<CreditBatchLateRunsNotice runs={[]} creditBatchId="batch-1" facilityId="facility-1" />);
    expect(container.textContent).toBe("");
  });
});
