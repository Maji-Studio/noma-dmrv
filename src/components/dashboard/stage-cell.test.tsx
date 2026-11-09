// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardStation } from "@/data-access/dashboard-overview";
import { StageText } from "./stage-cell";

afterEach(cleanup);

const station: DashboardStation = {
  key: "production",
  name: "Production",
  total: 3,
  totalLabel: "3 runs",
  attention: 0,
  reasons: [],
  href: "/production-runs?facility=f1",
};

describe("StageText", () => {
  it("shows the stage name over the counted figure and links the stage to its list", () => {
    render(<StageText station={station} align="start" />);
    expect(screen.getByRole("link", { name: "Production, 3 runs. Open Production runs" }).getAttribute("href")).toBe(
      "/production-runs?facility=f1",
    );
    expect(screen.getByText("3 runs")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("adds an open-items bubble with the count when the stage has open items", () => {
    render(
      <StageText
        station={{ ...station, attention: 2, reasons: [{ state: "warning", text: "PR-1: Run missing data", href: "/x" }] }}
        align="start"
      />,
    );
    const bubble = screen.getByRole("button", { name: "2 open items" });
    expect(bubble.textContent).toBe("2");
  });
});
