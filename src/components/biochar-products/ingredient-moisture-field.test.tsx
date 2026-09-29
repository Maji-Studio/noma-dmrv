import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type ReactNode } from "react";
import { useForm, type Control, type FieldValues } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ moisture: 100 / 15 as number | null }));
vi.mock("@/hooks/use-entities", () => ({ useEntityById: () => ({ data: { mass: { moisturePercent: state.moisture } } }) }));
vi.mock("@/components/forms", () => ({
  FormField: ({ children, helperText, warning, hint }: { children: ReactNode; helperText?: string; warning?: string; hint?: ReactNode }) => <div><span data-part="helper">{helperText}</span><span data-part="warning">{warning}</span><span data-part="hint">{hint}</span>{children}</div>,
  FormInput: "input",
}));
import { IngredientMoistureField } from "./ingredient-moisture-field";

function Harness({ frozen = false, saved = false }: { frozen?: boolean; saved?: boolean }) {
  const form = useForm({ defaultValues: { ingredientBins: [{ storageLocationId: "bin", massKg: 100, moistureContentPercent: saved ? 12 : null }] } });
  return <><IngredientMoistureField control={form.control as unknown as Control<FieldValues>} index={0} frozen={frozen} disabled={false} /><button onClick={() => form.getValues()}>Read</button></>;
}

const part = (renderer: ReactTestRenderer, name: string) => renderer.root.find(node => node.props["data-part"] === name).props.children;

describe("IngredientMoistureField", () => {
  it("starts empty, shows the bin estimate as a hint and keeps what the operator measured", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />); });
    expect(renderer.root.findByType("input").props.value).toBe("");
    expect(part(renderer, "helper")).toBe("Estimated moisture: 6.7%");
    expect(part(renderer, "warning")).toBeUndefined();
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "18" } }));
    expect(part(renderer, "warning")).toBe("This reading is 11.3 points from the estimated 6.7%. Check the reading before you save.");
    state.moisture = 5;
    await act(async () => renderer.update(<Harness />));
    const values = renderer.root.findByType("button").props.onClick();
    expect(values.ingredientBins[0].moistureContentPercent).toBe(18);
    await act(async () => renderer.unmount());
    state.moisture = 100 / 15;
  });
  it("keeps a saved frozen measurement", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness saved frozen />); });
    const input = renderer.root.findByType("input");
    expect(input.props.value).toBe(12);
    expect(input.props.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });
});
