// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchKpiStrip } from "./batch-emissions-toolbar";

// The working facility is UTC; the strip must still read the batch's own zone.
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "working" }),
  useFacilityClock: () => ({ timeZone: "UTC", hint: "" }),
}));

afterEach(cleanup);

describe("BatchKpiStrip Last entry", () => {
  const kpis = { open: 0, total: 1, filesMissing: 0, entriesThisMonth: 0, lastEntryAt: new Date("2026-09-30T22:30:00Z") };
  it("reads Oct 1 in the archived batch's Africa/Dar_es_Salaam zone", () => {
    render(<BatchKpiStrip kpis={kpis} timeZone="Africa/Dar_es_Salaam" filter={null} onFilter={vi.fn()} />);
    expect(screen.getByText(/Oct 1/)).toBeTruthy();
    expect(screen.queryByText(/Sep 30/)).toBeNull();
  });
});
