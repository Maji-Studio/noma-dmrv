import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardStation, DashboardStationKey } from "@/data-access/dashboard-stations";
import { FlowHeroScene } from "./flow-hero-scene";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const KEYS: DashboardStationKey[] = ["suppliers", "feedstock", "production", "products", "deliveries", "applications"];

function stations(key: DashboardStationKey, station: Partial<DashboardStation>): DashboardStation[] {
  return KEYS.map((k) => ({
    key: k, name: k, total: 1, totalLabel: "1", attention: 0, reasons: [], href: "#",
    ...(k === key ? station : {}),
  }));
}

function render(list: DashboardStation[], view: "overview" | "attention") {
  return renderToStaticMarkup(
    <FlowHeroScene stations={list} massFlow={[]} runningRuns={0} view={view} ghosted={false} />,
  );
}

describe("FlowHeroScene", () => {
  it("badges Suppliers once supplier GPS gaps give it attention (#1532)", () => {
    const html = render(
      stations("suppliers", { attention: 2, reasons: [{ state: "warning", text: "2 feedstocks without supplier GPS", href: "/suppliers?facility=f1" }] }),
      "overview",
    );
    expect(html).toContain('data-testid="flow-hero-badge-suppliers"');
  });

  it("links a reason fixed off the station's list, and draws no strip without reasons", () => {
    const html = render(
      stations("production", { attention: 1, reasons: [{ state: "warning", text: "1 credit batch not submitted", href: "/credit-batches?facility=f1" }] }),
      "attention",
    );
    expect(html).toContain('href="/credit-batches?facility=f1"');
    expect(render(stations("production", {}), "attention")).not.toContain("flow-hero-reasons");
  });

  it("lets a long station tooltip overflow the cropped scene instead of clipping its list link", () => {
    const html = render(stations("production", {}), "overview");
    const scene = html.match(/<div class="([^"]*)"[^>]*data-testid="flow-hero-scene"/)?.[1] ?? "";
    expect(scene).toContain("relative");
    expect(scene).not.toContain("overflow-hidden");
  });
});
