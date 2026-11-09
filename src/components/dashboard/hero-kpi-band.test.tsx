// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardKpi } from "@/data-access/dashboard-overview";
import { HeroKpiBand } from "./hero-kpi-band";

afterEach(cleanup);

const kpi = (over: Partial<DashboardKpi>): DashboardKpi => ({
  key: "feedstockProcessed",
  label: "Feedstock processed",
  unit: "t",
  value: 2.4,
  deltaPercent: null,
  detail: "",
  ...over,
});

describe("HeroKpiBand", () => {
  it("carries the mass basis in the unit and reads a true zero as 0", () => {
    render(
      <HeroKpiBand
        isLoading={false}
        kpis={[kpi({}), kpi({ key: "appliedToSoil", label: "Applied to soil", value: 0 })]}
      />,
    );
    expect(screen.getByText("2.4")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getAllByText("t dry")).toHaveLength(2);
  });

  it("draws an unknown value as a muted bar named No value, with no reason", () => {
    render(<HeroKpiBand isLoading={false} kpis={[kpi({ value: null, detail: "no measured runs", hint: "What it measures." })]} />);
    expect(screen.getByRole("img", { name: "No value" })).toBeTruthy();
    expect(screen.queryByText(/no measured runs/i)).toBeNull();
    expect(screen.getByRole("button", { name: "More about Feedstock processed" })).toBeTruthy();
  });
});
