import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardStation, DashboardStationKey } from "@/data-access/dashboard-stations";
import { FlowHeroMobile } from "./flow-hero-mobile";

const KEYS: DashboardStationKey[] = ["suppliers", "feedstock", "production", "products", "deliveries", "applications"];

function render(production: Partial<DashboardStation>) {
  const stations = KEYS.map((key) => ({
    key, name: key, total: 1, totalLabel: "1", attention: 0, reasons: [], href: `/${key}`,
    ...(key === "production" ? production : {}),
  }));
  return renderToStaticMarkup(<FlowHeroMobile stations={stations} massFlow={[]} />);
}

describe("FlowHeroMobile", () => {
  it("links reasons fixed off the station's list, as the desktop strip does (#1532)", () => {
    const html = render({
      attention: 3,
      reasons: [
        { state: "warning", text: "2 runs missing mass data" },
        { state: "warning", text: "1 credit batch not submitted", href: "/credit-batches?facility=f1" },
      ],
    });
    expect(html).toContain('data-testid="flow-hero-mobile-reasons-production"');
    expect(html).toContain('href="/credit-batches?facility=f1"');
    // The plain reason is listed too, so the visible reasons add up to the badge.
    expect(html).toContain(">2 runs missing mass data<");
    expect(html).not.toContain('data-testid="flow-hero-mobile-reasons-feedstock"');
  });

  it("finds the running-runs reason by its source, not by its state", () => {
    const html = render({
      reasons: [
        { state: "in-progress", text: "Other progress" },
        { state: "in-progress", text: "1 running now", source: "runningRuns" },
      ],
    });
    expect(html).toContain("1 · 1 running now");
    expect(html).not.toContain("1 · Other progress");
  });
});
