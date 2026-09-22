import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, expect, it, vi } from "vitest";
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import type { ApplicationAllocationShare } from "@/data-access/delivery-allocation-provenance";

// The caption's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have; the hint's copy is not what this test asserts.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
import { ApplicationAllocationShares } from "./application-allocation-shares";

function visible(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
}

function share(productId: string, productCode: string, runId: string, runCode: string, dryMassKg: number): ApplicationAllocationShare {
  return { applicationId: "application", deliveryId: "delivery", biocharProductId: productId, productCode, productionRunId: runId, productionRunCode: runCode, dryMassKg, wetMassKg: dryMassKg * 2 };
}

const shares = [
  share("product-a", "BP-26-001", "run-a", "PR-26-001", 450),
  share("product-a", "BP-26-001", "run-b", "PR-26-002", 150),
  share("product-b", "BP-26-002", "run-c", "PR-26-003", 125),
];

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

it("carries the bar and its key in Simple, then adds the ledger and the run split in Detailed", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FormDetailProvider scope="application"><FormDetailControl /><ApplicationAllocationShares shares={shares} /></FormDetailProvider>); });
  const simple = visible(renderer.root);
  // The key line names each batch and its dry mass, so Simple already answers
  // which batches were applied without the ledger's percentages.
  expect(simple).toContain("BP-26-001");
  expect(simple).toContain("600 kg");
  expect(simple).toContain("125 kg");
  expect(simple).not.toContain("% of total");
  expect(renderer.root.findAllByType("button")).toHaveLength(0);

  await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
  expect(visible(renderer.root)).toContain("% of total");
  const disclosure = renderer.root.findAllByType("button").find(node => node.props["aria-controls"])!;
  await act(async () => disclosure.props.onClick());
  const runs = renderer.root.findByProps({ "aria-label": "Source production runs per applied batch" });
  expect(visible(runs)).toContain("PR-26-001");
  expect(visible(runs)).toContain("450 kg");
  expect(visible(runs)).toContain("PR-26-003");
  await act(async () => renderer.unmount());
});

it("gives each applied batch its own accent so adjacent blocks stay distinguishable", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ApplicationAllocationShares shares={shares} />); });
  const bar = renderer.root.findByProps({ role: "img" });
  const fills = bar.children
    .filter((child): child is ReactTestInstance => typeof child !== "string")
    .map(child => child.props.style.background);
  expect(fills).toEqual(["var(--acc-prod)", "var(--acc-infra)"]);
  await act(async () => renderer.unmount());
});

it("renders nothing when no batch was traced", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<ApplicationAllocationShares shares={[]} />); });
  expect(renderer.toJSON()).toBeNull();
  await act(async () => renderer.unmount());
});
