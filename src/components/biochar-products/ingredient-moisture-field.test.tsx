import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { type ReactNode } from "react";
import { useForm, type Control, type FieldValues } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ moisture: 25 }));
vi.mock("@/hooks/use-entities", () => ({ useEntityById: () => ({ data: { mass: { moisturePercent: state.moisture } } }) }));
vi.mock("@/components/forms", () => ({ FormField: ({ children }: { children: ReactNode }) => <div>{children}</div>, FormInput: "input" }));
import { IngredientMoistureField } from "./ingredient-moisture-field";

function Harness({ frozen = false, saved = false }: { frozen?: boolean; saved?: boolean }) {
  const form = useForm({ defaultValues: { ingredientBins: [{ storageLocationId: "bin", massKg: 100, moistureContentPercent: saved ? 12 : null, moistureSource: saved ? "operator_override" : "oldest_intake" }] } });
  return <><IngredientMoistureField control={form.control as unknown as Control<FieldValues>} index={0} frozen={frozen} disabled={false} /><button onClick={() => form.getValues()}>Read</button></>;
}

describe("IngredientMoistureField", () => {
  it("prefills the oldest intake and records an operator override when edited", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness />); });
    expect(renderer.root.findByType("input").props.value).toBe(25);
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "18" } }));
    const values = renderer.root.findByType("button").props.onClick();
    expect(values.ingredientBins[0]).toMatchObject({ moistureContentPercent: 18, moistureSource: "operator_override" });
    await act(async () => renderer.unmount());
  });
  it("does not replace a saved frozen measurement with changed intake moisture", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<Harness saved frozen />); });
    const input = renderer.root.findByType("input");
    expect(input.props.value).toBe(12);
    expect(input.props.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });
});
