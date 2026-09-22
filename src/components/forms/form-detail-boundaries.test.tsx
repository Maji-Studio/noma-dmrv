import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { beforeAll, describe, expect, it } from "vitest";
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
    expect(simple).not.toContain("Before loading");
    expect(simple).not.toContain("After loading");
    expect(simple).not.toContain("1,150 kg");
    expect(simple).not.toContain("Details");
    expect(simple).not.toContain("More info");
    expect(simple).not.toContain("Batch breakdown");
    expect(renderer.root.findByType("a").props.href).toBe("/applications?ids=app-id");
    await act(async () => renderer.root.findAllByType("input")[1].props.onChange());
    expect(visibleText(renderer.root)).not.toContain("Batch breakdown");
    const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
    expect(disclosure.props["aria-expanded"]).toBe(false);
    await act(async () => disclosure.props.onClick());
    expect(visibleText(renderer.root)).toContain("Batch breakdown");
    expect(visibleText(renderer.root)).toContain("Before loading");
    expect(visibleText(renderer.root)).toContain("After loading");
    expect(JSON.stringify(renderer.toJSON())).toContain("Correction blocked");
    await act(async () => renderer.unmount());
  });

  it("hides derived mass readouts while retaining eligibility warnings and saved fields", async () => {
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
    expect(simple).not.toContain("80kg");
    expect(simple).not.toContain("60 kg");
    expect(simple).not.toContain("Moisture");
    expect(simple).toContain("exceeds the biochar eligibility ceiling");
    expect(simple).toContain("Durability");
    expect(simple).toContain("Sampling date");
    expect(simple).not.toContain("formula-v1");
    expect(renderer.root.findAllByProps({ role: "img" })).toHaveLength(0);
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
  await act(async () => renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!.props.onClick());
  expect(visibleText(renderer.root)).toContain("80 kg");
  await act(async () => renderer.unmount());
});
