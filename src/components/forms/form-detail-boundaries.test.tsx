import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// The real InfoHint mounts a floating-ui tooltip, which reads `window` on
// mount, and these suites run in the node environment. The hint's own
// behaviour is covered by the tooltip tests; here it is inert.
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: ({ label }: { children: ReactNode; label: string }) => <span aria-label={label} />,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
import { SpineSectionStatic } from "./form-spine";
import { FormDetailControl, FormDetailProvider } from "./form-detail-context";
import { OutputStockPreview } from "@/components/storage-locations/output-stock-preview";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { SampleEligibilityAdvisory } from "@/components/samples/sample-eligibility-advisory";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import type { OutputStockPreview as Preview } from "@/types/output-stock";

function visibleText(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  if (node.props.hidden) return "";
  return node.children.map(visibleText).join(" ");
}

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
const preview: Preview = {
  basisFingerprint: "basis", storageLocationId: "bin", binName: "Product bin", binCode: "PB-001", formulationName: "Mix", lane: "product",
  beforeDryKg: 1500, afterDryKg: 350, beforeSolidsKg: 1820, afterSolidsKg: 420,
  removedDryKg: 1150, removedWetKg: 2000, estimateMoisturePercent: 30,
  beforeEstimatedWetKg: 2600, afterEstimatedWetKg: 600, discrepancySolidsKg: 12, blockingMessage: "Correction blocked",
  blockers: [{ entity: "application", id: "app-id", code: "APP-001" }],
  allocations: [{ layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 1150, runs: [{ productionRunId: "r1", code: "Run A", dryMassKg: 1150 }] }],
};

describe("optional detail boundaries", () => {
  it("keeps warnings and blockers but hides optional stock readouts in Simple", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="stock"><FormDetailControl /><OutputStockPreview followFormDetail preview={preview} /></FormDetailProvider>); });
    const simple = visibleText(renderer.root);
    expect(simple).toContain("Correction blocked");
    expect(simple).toContain("Count exceeds tracked solids");
    expect(simple).not.toContain("Product bin");
    expect(simple).not.toContain("1,150 kg");
    expect(simple).not.toContain("Details");
    expect(simple).not.toContain("More info");
    expect(simple).not.toContain("Batch A");
    expect(renderer.root.findByType("a").props.href).toBe("/applications?ids=app-id");
    await act(async () => renderer.root.findAllByType("input")[1].props.onChange());
    expect(visibleText(renderer.root)).not.toContain("Batch A");
    const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
    expect(disclosure.props["aria-expanded"]).toBe(false);
    await act(async () => disclosure.props.onClick());
    expect(visibleText(renderer.root)).toContain("Batch A");
    expect(visibleText(renderer.root)).toContain("1,150 kg");
    expect(JSON.stringify(renderer.toJSON())).toContain("Correction blocked");
    await act(async () => renderer.unmount());
  });

  it("keeps the moisture bar and key in Simple while hiding its calculation table", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="read">
      <MoistureSplit followFormDetail wetMassKg={100} moisturePercent={20} />
      <MoistureSplit followFormDetail wetMassKg={100} moisturePercent={null} />
      <ProductCompositionPreview followFormDetail wetMassKg={100} dryBiocharKg={60} />
      <SampleEligibilityAdvisory hToCOrgRatio={0.8} oToCOrgRatio={0.3} />
      <EntitySideSheetSections sections={[{ title: "Definition", fields: [
        { label: "Preview formula", value: "formula-v1", detailedOnly: true },
        { label: "Durability", value: "1,000 years" },
        { label: "Sampling date", value: "2026-09-22" },
      ] }]} />
    </FormDetailProvider>); });
    const simple = visibleText(renderer.root);
    // The bar and its key are what the wet mass and moisture inputs mean, so
    // they stay in Simple. Only the calculation table below them is optional.
    expect(simple).toContain("Dry");
    expect(simple).toContain("80 kg");
    expect(simple).toContain("Water");
    expect(simple).toContain("20 kg");
    expect(simple).not.toContain("% of total");
    expect(simple).not.toContain("Dry = wet");
    // A missing moisture reading still names the field it is waiting on.
    expect(simple).toContain("not recorded.");
    // The product bar follows the same rule: its parts are what the mass and
    // ingredient fields mean, and only its ledger waits for Detailed.
    expect(simple).toContain("Product composition");
    expect(simple).toContain("Dry biochar");
    expect(simple).toContain("60 kg");
    expect(simple).not.toContain("Show calculation");
    // Other derived readouts stay hidden.
    expect(simple).toContain("exceeds the biochar eligibility ceiling");
    expect(simple).toContain("Durability");
    expect(simple).toContain("Sampling date");
    expect(simple).not.toContain("formula-v1");
    // The resolved moisture split and the product composition, one bar each.
    expect(renderer.root.findAllByProps({ role: "img" })).toHaveLength(2);
    await act(async () => renderer.unmount());
  });
});

it("omits optional read-section headings in Simple and numbers visible sections contiguously", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FormDetailProvider scope="application"><FormDetailControl /><EntitySideSheetSections numbered sections={[
    { title: "Application", fields: [{ label: "Wet mass", value: "100 kg" }, { label: "Dry biochar applied (kg)", value: "80 kg", detailedOnly: true }] },
    { title: "Batch shares", detailedOnly: true, fields: [], content: <p>Saved source proportions</p> },
    { title: "Evidence", fields: [], content: <button type="button">Open evidence</button> },
  ]} /></FormDetailProvider>); });
  expect(visibleText(renderer.root)).not.toContain("Batch shares");
  expect(visibleText(renderer.root)).not.toContain("Dry biochar applied");
  expect(visibleText(renderer.root)).toContain("Open evidence");
  expect(renderer.root.findAllByType(SpineSectionStatic).map(node => node.props.meta)).toEqual([
    { index: 0, total: 2, first: true, last: false }, { index: 1, total: 2, first: false, last: true },
  ]);
  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  expect(visibleText(renderer.root)).toContain("Batch shares");
  expect(renderer.root.findAllByType(SpineSectionStatic).map(node => node.props.meta.index)).toEqual([0, 1, 2]);
  // Detailed shows the optional rows in place. They are recorded fields, not a
  // calculation, so no disclosure stands between the operator and the number.
  expect(visibleText(renderer.root)).toContain("80 kg");
  expect(renderer.root.findAllByType("button").filter(node => node.props["aria-controls"])).toHaveLength(0);
  await act(async () => renderer.unmount());
});
