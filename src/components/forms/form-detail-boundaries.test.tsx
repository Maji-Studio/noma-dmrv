import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it } from "vitest";
import { FormDetailControl, FormDetailProvider } from "./form-detail-context";
import { OutputStockPreview } from "@/components/storage-locations/output-stock-preview";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
import { SampleEligibilityAdvisory } from "@/components/samples/sample-eligibility-advisory";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import type { OutputStockPreview as Preview } from "@/types/output-stock";

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
  it("keeps stock consequences, excess-count warning and blocker links in Simple", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="stock"><FormDetailControl /><OutputStockPreview followFormDetail preview={preview} /></FormDetailProvider>); });
    const simple = JSON.stringify(renderer.toJSON());
    expect(simple).toContain("Correction blocked");
    expect(simple).toContain("Count exceeds tracked solids");
    expect(simple).toContain("Before loading");
    expect(simple).toContain("After loading");
    expect(simple).toContain("1,150 kg");
    expect(simple).not.toContain("Batch breakdown");
    expect(renderer.root.findByType("a").props.href).toBe("/applications?ids=app-id");
    await act(async () => renderer.root.findAllByType("input")[1].props.onChange());
    expect(JSON.stringify(renderer.toJSON())).toContain("Batch breakdown");
    expect(JSON.stringify(renderer.toJSON())).toContain("Correction blocked");
    await act(async () => renderer.unmount());
  });

  it("retains mass and missing-moisture readouts, eligibility warnings and cap/authority fields", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="read">
      <MoistureSplit followFormDetail wetMassKg={100} moisturePercent={20} />
      <MoistureSplit followFormDetail wetMassKg={100} moisturePercent={null} />
      <ProductCompositionPreview followFormDetail wetMassKg={100} dryBiocharKg={60} />
      <SampleEligibilityAdvisory hToCOrgRatio={0.8} oToCOrgRatio={0.3} />
      <EntitySideSheetSections sections={[{ title: "Definition", fields: [
        { label: "Preview formula", value: "formula-v1", detailedOnly: true },
        { label: "Durability cap applied", value: "Yes" },
        { label: "Preview authority", value: "Registry result remains authoritative" },
      ] }]} />
    </FormDetailProvider>); });
    const simple = JSON.stringify(renderer.toJSON());
    expect(simple).toContain("80kg");
    expect(simple).toContain("60 kg");
    expect(simple).toContain("Moisture");
    expect(simple).toContain("exceeds the biochar eligibility ceiling");
    expect(simple).toContain("Durability cap applied");
    expect(simple).toContain("Registry result remains authoritative");
    expect(simple).not.toContain("formula-v1");
    expect(renderer.root.findAllByProps({ role: "img" })).toHaveLength(0);
    await act(async () => renderer.unmount());
  });
});
