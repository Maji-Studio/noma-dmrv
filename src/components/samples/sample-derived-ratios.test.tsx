import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import type { CertFieldStatus } from "@/components/ui/certification-field-tag";

// The certification chip and the caption hint both mount Base UI tooltips,
// which read `window` on mount; this suite runs in the node environment.
vi.mock("@/components/ui/tooltip", () => ({
  InfoHint: () => null,
  Tooltip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
import { SampleDerivedRatios } from "./sample-derived-ratios";

function visible(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
}

const certify = { certifyRequired: () => true, certifyStatus: (): CertFieldStatus => "satisfied" };

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

it("shows both figures and keeps the atomic formulas behind the calculation", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SampleDerivedRatios hToCOrgRatio={0.42} oToCOrgRatio={0.15} hydrogenPercent={2.5} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab={false} detailed {...certify} />);
  });
  const shown = visible(renderer.root);
  expect(shown).toContain("0.4200");
  expect(shown).toContain("0.1500");
  expect(shown).not.toContain("atomic ratio");
  const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
  await act(async () => disclosure.props.onClick());
  const disclosed = visible(renderer.root);
  expect(disclosed).toContain("(2.5 / 1.008) / (71.5 / 12.011)");
  expect(disclosed).toContain("(12 / 15.999) / (71.5 / 12.011)");
  await act(async () => renderer.unmount());
});

it("offers no calculation in Simple and credits a lab O:C org to the lab", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SampleDerivedRatios hToCOrgRatio={0.42} oToCOrgRatio={0.2} hydrogenPercent={2.5} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab detailed={false} {...certify} />);
  });
  expect(renderer.root.findAllByType("button")).toHaveLength(0);
  await act(async () => renderer.unmount());

  await act(async () => {
    renderer = create(<SampleDerivedRatios hToCOrgRatio={0.42} oToCOrgRatio={0.2} hydrogenPercent={2.5} oxygenPercent={12} organicCarbonPercent={71.5} oToCFromLab detailed {...certify} />);
  });
  await act(async () => renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!.props.onClick());
  expect(visible(renderer.root)).toContain("comes from the lab ratio entered above");
  await act(async () => renderer.unmount());
});

it("names the unrecorded ratio and surfaces a refused derived value", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SampleDerivedRatios hToCOrgRatio={null} oToCOrgRatio={null} hydrogenPercent={null} oxygenPercent={null} organicCarbonPercent={null} oToCFromLab={false} detailed error="Ratio is above the saved precision." {...certify} />);
  });
  expect(visible(renderer.root)).toContain("Not recorded");
  expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("above the saved precision");
  await act(async () => renderer.unmount());
});
