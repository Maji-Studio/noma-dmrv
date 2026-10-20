import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardStation } from "@/data-access/dashboard-stations";
import { FlowHero } from "./flow-hero";

const captured = vi.hoisted(() => ({ stations: [] as DashboardStation[] }));

vi.mock("./flow-hero-defs", () => ({ FlowHeroDefs: () => null }));
vi.mock("./flow-hero-mobile", () => ({ FlowHeroMobile: () => null }));
vi.mock("./flow-hero-scene", () => ({
  FlowHeroScene: ({ stations }: { stations: DashboardStation[] }) => {
    captured.stations = stations;
    return null;
  },
}));

function render(isLoading: boolean) {
  renderToStaticMarkup(<FlowHero stations={undefined} massFlow={undefined} runningRuns={0} isLoading={isLoading} facilityId="f1" />);
}

describe("FlowHero placeholder stations", () => {
  beforeEach(() => { captured.stations = []; });

  it("says Loading while the overview loads", () => {
    render(true);
    expect(captured.stations.map((station) => station.totalLabel)).toEqual(Array(6).fill("Loading"));
  });

  it("claims no failure when nothing is loading and no stations arrived", () => {
    render(false);
    expect(captured.stations).toHaveLength(6);
    expect(captured.stations.map((station) => station.totalLabel)).toEqual(Array(6).fill(""));
  });
});
