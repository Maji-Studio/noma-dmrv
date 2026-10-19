import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
vi.mock("./production-incident-table", () => ({ ProductionIncidentTable: () => null }));
vi.mock("./production-readings-documents", () => ({ ProductionReadingsDocuments: () => null }));
vi.mock("./production-sample-table", () => ({ ProductionSampleTable: () => null }));
import { productionRunSheetSections } from "./production-run-read-sections";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

const run = {
  id: "run-1",
  status: "cancelled",
  cancellationReason: "Weather",
  reactorIdentifier: "Reactor 1",
  operatorName: "Op",
  feedstocks: [],
  feedstockDraws: [],
  totalFeedstockWetMassKg: 1000,
  feedstockMoisturePercent: 10,
  feedstockMassDryKg: 900,
  biocharOutputKg: 300,
  biocharMoisturePercent: 10,
  biocharDryMassKg: 270,
} as unknown as ProductionRunWithRelations;

describe("productionRunSheetSections", () => {
  it("orders Run setup like the form: status, reason, reactor, operator", () => {
    const labels = productionRunSheetSections(run, [])[0].fields.map((f) => f.label);
    expect(labels.slice(0, 4)).toEqual(["Status", "Cancellation reason", "Reactor", "Operator"]);
  });

  it("draws feedstock in and biochar out to one mass scale", () => {
    const sections = productionRunSheetSections(run, []);
    const widths = [sections[1].content, sections[2].content].map((node) => {
      const html = renderToStaticMarkup(<>{node}</>);
      return Number(html.match(/role="img"[^>]*style="width:([\d.]+)%/)?.[1]);
    });
    expect(widths[0]).toBe(100);
    expect(widths[1]).toBeCloseTo(30, 5);
  });
});
