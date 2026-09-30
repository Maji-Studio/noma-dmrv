/**
 * ChoiceCardGroup and SegmentedControl. The node test environment has no DOM,
 * so arrow-key movement (native radio behaviour) is covered in the output
 * stock parent form e2e spec; here we pin the structure the browser relies on: one shared name,
 * no custom tab stops or key handlers, the selected mark, disabled options,
 * and the react-hook-form round trip.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ChoiceCardGroup } from "./choice-card-group";
import { FormField } from "./form-field";
import { SegmentedControl } from "./segmented-control";

vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

const OPTIONS = [
  { value: "a", title: "Alpha", description: "First." },
  { value: "b", title: "Beta", description: "Second.", disabled: true },
  { value: "c", title: "Gamma" },
] as const;
const EVIDENCE_OPTIONS = [
  { value: "location", title: "Location" },
  { value: "boundary", title: "Boundary" },
] as const;
const SEGMENTS = [
  { value: "loss", label: "Record loss" },
  { value: "count", label: "Reconcile stock" },
] as const;

function mount(element: ReactElement): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => { renderer = create(element); });
  return renderer;
}

const radios = (root: ReactTestInstance) =>
  root.findAll((node) => node.type === "input" && node.props.type === "radio");

describe("radio structure", () => {
  for (const [name, element] of [
    ["ChoiceCardGroup", <ChoiceCardGroup key="c" legend="Pick" name="pick" value="a" options={OPTIONS} />],
    ["SegmentedControl", <SegmentedControl key="s" legend="Pick" name="pick" value="loss" options={SEGMENTS} />],
  ] as const) {
    it(`${name} is one native radio group with a legend and no custom tab stops`, () => {
      const r = mount(element);
      const inputs = radios(r.root);
      expect(inputs.length).toBeGreaterThan(1);
      expect(new Set(inputs.map((i) => i.props.name))).toEqual(new Set(["pick"]));
      expect(inputs.every((i) => i.props.tabIndex === undefined && i.props.onKeyDown === undefined)).toBe(true);
      const fieldset = r.root.findByType("fieldset");
      expect(fieldset).toBeTruthy();
      expect(r.root.findByType("legend").children).toContain("Pick");
      expect(inputs.filter((i) => i.props.checked)).toHaveLength(1);
    });
  }

  it("marks the selected card with a check glyph revealed only when checked", () => {
    const markup = renderToStaticMarkup(<ChoiceCardGroup legend="Pick" name="pick" value="a" options={OPTIONS} />);
    expect(markup).toContain("group-has-[input:checked]:opacity-100");
    expect(markup).toContain("peer-checked:border-[var(--color-interaction)]");
    expect(markup).toContain("forced-colors:peer-checked:border-2");
    expect(markup).toMatch(/checked=""[^>]*value="a"/);
    expect(markup).not.toMatch(/checked=""[^>]*value="c"/);
  });

  it("disables an option without disabling its siblings", () => {
    const r = mount(<ChoiceCardGroup legend="Pick" name="pick" value="a" options={OPTIONS} />);
    expect(radios(r.root).map((i) => Boolean(i.props.disabled))).toEqual([false, true, false]);
    const all = mount(<ChoiceCardGroup legend="Pick" name="pick" value="a" options={OPTIONS} disabled />);
    expect(radios(all.root).every((i) => i.props.disabled)).toBe(true);
  });

  it("reports the picked value through onValueChange", () => {
    const seen: string[] = [];
    const r = mount(<SegmentedControl legend="Pick" name="pick" value="loss" options={SEGMENTS} onValueChange={(v) => seen.push(v)} />);
    radios(r.root)[1].props.onChange({ target: { value: "count" } });
    expect(seen).toEqual(["count"]);
  });

  it("stacks cards by container width and sizes columns to the option count", () => {
    const two = renderToStaticMarkup(<ChoiceCardGroup legend="t" options={OPTIONS.slice(0, 2)} />);
    const three = renderToStaticMarkup(<ChoiceCardGroup legend="t" options={OPTIONS} />);
    expect(two).toContain("@container");
    expect(two).toContain("grid-cols-1");
    expect(two).toContain("@min-[17rem]:grid-cols-2");
    expect(three).toContain("@min-[34rem]:grid-cols-3");
  });
});

describe("react-hook-form", () => {
  function Harness({ onForm }: { onForm: (api: ReturnType<typeof useForm<{ evidenceMethod: string }>>) => void }) {
    const form = useForm<{ evidenceMethod: string }>({ defaultValues: { evidenceMethod: "boundary" } });
    onForm(form);
    return (
      <FormField id="evidenceMethod" label="Evidence method" error={form.formState.errors.evidenceMethod?.message}>
        <ChoiceCardGroup legend="Evidence method" options={EVIDENCE_OPTIONS} id="evidenceMethod" error={!!form.formState.errors.evidenceMethod} {...form.register("evidenceMethod")} />
      </FormField>
    );
  }

  it("applies the registered default through the radio refs and shows the error on the group", async () => {
    let api!: ReturnType<typeof useForm<{ evidenceMethod: string }>>;
    const nodes: { name: string; value: string; checked: boolean }[] = [];
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness onForm={(a) => (api = a)} />, {
        createNodeMock: (el) => {
          const props = el.props as { name: string; value: string };
          const node = { nodeType: 1, isConnected: true, type: "radio", name: props.name, value: props.value, checked: false, focus: () => undefined };
          nodes.push(node);
          return node;
        },
      });
    });
    expect(nodes.find((n) => n.value === "boundary")?.checked).toBe(true);
    expect(nodes.find((n) => n.value === "location")?.checked).toBe(false);

    // Every radio carries the registered name, so RHF sees one field.
    expect(new Set(radios(renderer.root).map((i) => i.props.name))).toEqual(new Set(["evidenceMethod"]));
    expect(api.getValues("evidenceMethod")).toBe("boundary");

    await act(async () => api.setError("evidenceMethod", { message: "Choose an evidence method." }));
    const fieldset = renderer.root.findByType("fieldset");
    expect(fieldset.props["aria-invalid"]).toBe(true);
    expect(fieldset.props["aria-describedby"]).toBe("evidenceMethod-error");
    expect(JSON.stringify(renderer.toJSON())).toContain("Choose an evidence method.");
  });
});
