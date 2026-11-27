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
  it("shows the Output section for a Failed run like a Complete one, with an Uncarbonized bin chip", () => {
    const output = (status: string) => productionRunSheetSections({ ...run, status, biocharStorageLocationName: "Reject bin", biocharStorageLocationUncarbonized: status === "failed" } as unknown as ProductionRunWithRelations, []).find((s) => s.title === "Output");
    expect(output("complete")).toBeDefined();
    const bin = output("failed")?.fields.find((f) => f.label === "Biochar storage")?.value;
    expect(renderToStaticMarkup(<>{bin}</>)).toContain("Uncarbonized");
    expect(output("complete")?.fields.find((f) => f.label === "Biochar storage")?.value).toBe("Reject bin");
  });

  it("shows the Uncarbonized chip from the bin's tag, not the run status", () => {
    const bin = (uncarbonized: boolean) => productionRunSheetSections({ ...run, status: "failed", biocharStorageLocationName: "Reject bin", biocharStorageLocationUncarbonized: uncarbonized } as unknown as ProductionRunWithRelations, [])
      .find((s) => s.title === "Output")?.fields.find((f) => f.label === "Biochar storage")?.value;
    expect(bin(false)).toBe("Reject bin");
    expect(renderToStaticMarkup(<>{bin(true)}</>)).toContain("Uncarbonized");
  });

  it("puts no CERT chip on a Failed run's output mass and moisture", () => {
    const fields = (status: string) => productionRunSheetSections({ ...run, status } as unknown as ProductionRunWithRelations, []).find((s) => s.title === "Output")!.fields.filter((f) => f.label !== "Biochar storage");
    expect(fields("complete").some((f) => f.certifyRequired)).toBe(true);
    expect(fields("failed").some((f) => f.certifyRequired)).toBe(false);
  });

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

  it("hands the Samples and incidents the run's own facility zone", () => {
    const archivedRun = { ...run, facilityId: "archived" } as ProductionRunWithRelations;
    const sections = productionRunSheetSections(archivedRun, [{ id: "archived", timezone: "Africa/Dar_es_Salaam" }]);
    const children = (sections.at(-1)!.content as { props: { children: { props: { timeZone?: string } }[] } }).props.children;
    expect(children.map((child) => child.props.timeZone)).toEqual(["Africa/Dar_es_Salaam", "Africa/Dar_es_Salaam"]);
  });
});
