import { useState } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The caption's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
import { CompositionCard } from "./composition-card";
import { DerivedHeadline } from "./derived-headline";
import { FormDetailControl, FormDetailProvider, type SimplePresence } from "./form-detail-context";

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));
function History() {
  const [value, setValue] = useState("original");
  return <input aria-label="History correction" value={value} onChange={() => setValue("correction draft")} />;
}
function Form() {
  const { formState } = useForm({ defaultValues: { mass: 100 } });
  return <form><output>{formState.isDirty ? "dirty" : "clean"}</output><CompositionCard title="Bin composition" calculation={<History />}><p>100 kg</p></CompositionCard></form>;
}
it("starts collapsed, keeps correction drafts mounted, and never submits or dirties the form", async () => {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Form />); });
  const button = () => renderer.root.findByType("button");
  expect(button().props["aria-label"]).toBe("Show calculation for bin composition");
  const panel = () => renderer.root.findByProps({ id: button().props["aria-controls"] });
  expect(button().props.type).toBe("button");
  expect(button().props["data-presentation-control"]).toBe(true);
  expect(button().props["aria-expanded"]).toBe(false);
  expect(panel().props.hidden).toBe(true);
  await act(async () => button().props.onClick());
  expect(panel().props.hidden).toBe(false);
  await act(async () => renderer.root.findByType("input").props.onChange());
  await act(async () => button().props.onClick());
  await act(async () => button().props.onClick());
  expect(renderer.root.findByType("input").props.value).toBe("correction draft");
  expect(renderer.root.findByType("output").children).toEqual(["clean"]);
  await act(async () => renderer.unmount());
});

function visible(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
}

function Block({ simple }: { simple?: SimplePresence }) {
  return (
    <CompositionCard
      title="Bin stock"
      simple={simple}
      headline={<DerivedHeadline label="Wet stock in bin, estimate" before="≈ 1,420" value="1,110 kg" sub="310 kg wet removed at 22.7% moisture" />}
      detail={<p>Dry biochar pair</p>}
      calculation={<p>Batch ledger</p>}
      actions={<button type="button">Stock history</button>}
    >
      <p>Split bar</p>
    </CompositionCard>
  );
}

describe("Simple presence", () => {
  it.each([
    { simple: "picture" as const, present: ["Bin stock", "1,110 kg", "Split bar", "Stock history"], absent: ["Dry biochar pair", "Show calculation"] },
    { simple: "headline" as const, present: ["Bin stock", "≈ 1,420", "to", "1,110 kg", "310 kg wet removed"], absent: ["Split bar", "Dry biochar pair", "Stock history", "Show calculation"] },
    { simple: "hidden" as const, present: [], absent: ["Bin stock", "1,110 kg", "Split bar", "Stock history"] },
  ])("$simple keeps only its parts in Simple, and Detailed shows the whole block", async ({ simple, present, absent }) => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="block"><FormDetailControl /><Block simple={simple} /></FormDetailProvider>); });
    const shown = visible(renderer.root);
    for (const text of present) expect(shown).toContain(text);
    for (const text of absent) expect(shown).not.toContain(text);
    await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
    const detailed = visible(renderer.root);
    for (const text of ["Bin stock", "1,110 kg", "Split bar", "Dry biochar pair", "Show calculation", "Stock history"]) expect(detailed).toContain(text);
    expect(detailed).not.toContain("Batch ledger");
    await act(async () => renderer.unmount());
  });

  it("shows the whole block outside a detail provider", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Block simple="hidden" />); });
    expect(visible(renderer.root)).toContain("Dry biochar pair");
    expect(visible(renderer.root)).toContain("Show calculation");
    await act(async () => renderer.unmount());
  });

  it("names a figure it cannot derive yet", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<DerivedHeadline label="Yield" value={null} />); });
    expect(visible(renderer.root)).toContain("Not available");
    await act(async () => renderer.unmount());
  });
});
