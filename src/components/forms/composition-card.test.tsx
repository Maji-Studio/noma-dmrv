import { useState } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The caption's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
import { CompositionCard } from "./composition-card";
import { DerivedHeadline } from "./derived-headline";
import { FormDetailControl, FormDetailProvider } from "./form-detail-context";

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

function Block() {
  return (
    <CompositionCard
      title="Bin stock"
      headline={<DerivedHeadline label="Wet stock in bin, estimate" before="≈ 1,420" value="1,110 kg" sub="310 kg wet removed at 22.7% moisture" />}
      detail={<p>Dry biochar pair</p>}
      calculation={<p>Batch ledger</p>}
      actions={<button type="button">Stock history</button>}
    >
      <p>Split bar</p>
    </CompositionCard>
  );
}

describe("detail levels", () => {
  it("shows caption, headline, picture and actions at both levels; Detailed adds only explanation", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="block"><FormDetailControl /><Block /></FormDetailProvider>); });
    const simple = visible(renderer.root);
    for (const text of ["Bin stock", "≈ 1,420", "1,110 kg", "310 kg wet removed", "Split bar", "Stock history"]) expect(simple).toContain(text);
    for (const text of ["Dry biochar pair", "Show calculation"]) expect(simple).not.toContain(text);
    await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
    const detailed = visible(renderer.root);
    for (const text of ["Bin stock", "1,110 kg", "Split bar", "Dry biochar pair", "Show calculation", "Stock history"]) expect(detailed).toContain(text);
    expect(detailed).not.toContain("Batch ledger");
    await act(async () => renderer.unmount());
  });

  it("shows the whole block outside a detail provider", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Block />); });
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
