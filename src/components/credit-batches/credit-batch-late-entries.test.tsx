// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreditBatchLateEntries } from "./credit-batch-late-entries";

const lines = vi.fn();
vi.mock("@/hooks/use-emission-entries", () => ({ useBatchEmissionLines: () => ({ data: lines() }) }));

const DEST = { removalId: "rm-10", removalCode: "RM-26-010", creditBatchCodes: ["CB-26-010"], creditBatchIds: ["cb-10"], anotherCreditBatch: true };
const entry = (id: string, extra: object) => ({
  id, componentId: "diesel", kind: "value", hasEvidence: true, occurredOn: "2026-09-14", total: { magnitude: "120", unit: "l" }, counts: true, ...extra,
});
const line = (...entries: object[]) => [{ displayName: "Diesel use", entries }];
const receiver = { receiver: DEST, waitingReason: null };

describe("CreditBatchLateEntries", () => {
  beforeEach(() => lines.mockReset());

  it("renders nothing without late entries", () => {
    lines.mockReturnValue(line(entry("a", {})));
    expect(render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" canManage />).container.innerHTML).toBe("");
  });

  it("links the Removal code once in the heading and the batch in each entry", () => {
    const after = { removalId: "rm-9", removalCode: "RM-26-009" };
    lines.mockReturnValue(line(entry("a", { recordedAfter: after, carry: receiver }), entry("b", { recordedAfter: after, carry: receiver })));
    const { container } = render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" canManage />);
    expect(container.querySelector("h3")?.textContent).toContain("Recorded after RM-26-009 was sent");
    expect(screen.getAllByRole("link", { name: "RM-26-009" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "RM-26-009" })[0].getAttribute("href")).toBe("/certification/removals?facility=f1&removal=rm-9");
    expect(screen.getAllByRole("link", { name: "CB-26-010" })[0].getAttribute("href")).toBe("/credit-batches/cb-10?facility=f1");
    expect(container.textContent).toContain("Goes into RM-26-010 of credit batch CB-26-010.");
  });

  it("says a late entry goes into the revision of its own earlier Removal", () => {
    const revisionOf = { removalId: "rm-9", removalCode: "RM-26-009" };
    lines.mockReturnValue(line(entry("late", { recordedAfter: revisionOf, revisionOf })));
    const { container } = render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" canManage />);
    expect(container.textContent).toContain("Goes into the revision of RM-26-009.");
    expect(screen.getAllByRole("link", { name: "RM-26-009" }).map(link => link.getAttribute("href")))
      .toEqual(["/certification/removals?facility=f1&removal=rm-9", "/certification/removals?facility=f1&removal=rm-9"]);
  });

  it("joins several earlier Removals", () => {
    lines.mockReturnValue(line(
      entry("a", { recordedAfter: { removalId: "rm-8", removalCode: "RM-26-008" }, carry: receiver }),
      entry("b", { recordedAfter: { removalId: "rm-9", removalCode: "RM-26-009" }, carry: receiver }),
    ));
    const { container } = render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" canManage />);
    expect(container.querySelector("h3")?.textContent).toContain("Recorded after RM-26-008 and RM-26-009 were sent");
  });

  it("lists a waiting entry that has no earlier sent Removal under a plain heading", () => {
    lines.mockReturnValue(line(entry("a", { carry: { receiver: null, waitingReason: "noDraft" } })));
    const { container } = render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" canManage />);
    expect(container.querySelector("h3")?.textContent).toContain("Emissions for other Removals");
    expect(container.textContent).toContain("Waiting for a Removal.");
    expect(container.textContent).not.toContain("Recorded after");
  });

  it("names the earlier Removal under an entry when the heading cannot", () => {
    lines.mockReturnValue(line(
      entry("a", { recordedAfter: { removalId: "rm-9", removalCode: "RM-26-009" }, carry: receiver }),
      entry("b", { carry: receiver }),
    ));
    const { container } = render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" canManage />);
    expect(container.querySelector("h3")?.textContent).toBe("Emissions for other Removals");
    expect(container.textContent).toContain("Recorded after RM-26-009 was sent.");
  });

  it("leaves out an entry its own batch's Removal sent", () => {
    lines.mockReturnValue(line(entry("a", { recordedAfter: { removalId: "rm-9", removalCode: "RM-26-009" }, reportedIn: { ...DEST, anotherCreditBatch: false } })));
    expect(render(<CreditBatchLateEntries facilityId="f1" creditBatchId="cb" canManage />).container.innerHTML).toBe("");
  });
});
