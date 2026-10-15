import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useForm, createFormControl, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { expect, it, vi } from "vitest";
import { biocharProductFormSchema, INGREDIENT_MOISTURE_REQUIRED } from "@/schemas/biochar-products";
import { ResolvedErrorRevalidator } from "./resolved-error-revalidator";

it("stops after unchanged validation values and revalidates changed date/array fields", async () => {
  const schema = z.object({ delivery: z.string().min(1), date: z.date(), lines: z.array(z.number()) });
  type Values = z.infer<typeof schema>;
  const resolver = vi.fn(zodResolver(schema));
  const form = createFormControl<Values>({ resolver, mode: "onTouched", defaultValues: { delivery: "", date: new Date("2026-01-01"), lines: [1] } });
  function Form() {
    useForm<Values>({ formControl: form.formControl });
    form.register("delivery");
    form.register("date");
    form.register("lines");
    return <ResolvedErrorRevalidator control={form.control} trigger={form.trigger} />;
  }
  let tree: ReactTestRenderer;
  await act(async () => { tree = create(<Form />); });
  await act(async () => { await form.handleSubmit(() => undefined)(); });
  expect(form!.getFieldState("delivery").error).toBeDefined();
  const afterSubmit = resolver.mock.calls.length;
  await act(async () => { form.setValue("date", new Date("2026-01-01")); form.setValue("lines", [1]); });
  expect(resolver).toHaveBeenCalledTimes(afterSubmit);
  await act(async () => { form.setValue("date", new Date("2026-01-02")); });
  expect(resolver.mock.calls.length).toBeGreaterThan(afterSubmit);
  const afterDate = resolver.mock.calls.length;
  await act(async () => { form.setValue("lines", [1, 2]); });
  expect(resolver.mock.calls.length).toBeGreaterThan(afterDate);
  await act(async () => { form.setValue("delivery", "delivery-id"); });
  expect(form!.getFieldState("delivery").error).toBeUndefined();
  await act(async () => { tree!.unmount(); });
});

it("clears ingredient moisture errors when its mass becomes zero", async () => {
  const schema = biocharProductFormSchema.pick({ ingredientBins: true });
  const id = "11111111-1111-4111-8111-111111111111";
  const resolver = vi.fn(zodResolver(schema));
  const form = createFormControl({
    resolver,
    mode: "onTouched",
    defaultValues: { ingredientBins: [{
      formulationIngredientId: id, feedstockTypeId: id,
      feedstockTypeName: "Compost", feedstockTypeCategory: "compost",
      massKg: 10, moistureContentPercent: null,
    }] },
  });
  function Form() {
    useForm({ formControl: form.formControl });
    form.register("ingredientBins.0.moistureContentPercent");
    return <>
      <Controller control={form.control} name="ingredientBins.0.massKg" render={({ field }) => (
        <input name={field.name} onChange={field.onChange} />
      )} />
      <ResolvedErrorRevalidator control={form.control} trigger={form.trigger} />
    </>;
  }
  let tree: ReactTestRenderer;
  await act(async () => { tree = create(<Form />); });
  await act(async () => { await form.handleSubmit(() => undefined)(); });
  expect(form.getFieldState("ingredientBins.0.moistureContentPercent").error?.message).toBe(INGREDIENT_MOISTURE_REQUIRED);
  const afterSubmit = resolver.mock.calls.length;
  await act(async () => { tree!.root.findByType("input").props.onChange(0); });
  expect(schema.safeParse(form.getValues()).success).toBe(true);
  expect(resolver.mock.calls.length).toBeGreaterThan(afterSubmit);
  expect(form.getFieldState("ingredientBins.0.moistureContentPercent").error).toBeUndefined();
  await act(async () => { tree!.unmount(); });
});
