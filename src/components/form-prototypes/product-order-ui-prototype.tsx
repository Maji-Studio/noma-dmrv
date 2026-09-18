"use client";

/** Throwaway inline design on existing protected routes, via ?prototype=stock. */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/ui";
import { FormInput } from "@/components/forms/form-input";
import { FormSelect } from "@/components/forms/form-select";
import { FormField } from "@/components/forms/form-field";
import { FormSection } from "@/components/forms/form-section";
import { FormSpine } from "@/components/forms/form-spine";
import { FormActions } from "@/components/forms/form-actions";
import { formatMassKg } from "@/lib/format-utils";
import { MOISTURE_BASIS_HINT } from "@/lib/mass-moisture";
import { MASS_KG_INPUT_STEP, requiredMassKgSchema } from "@/schemas/helpers";
import { productOrderPrototypeSchema } from "@/schemas/product-order-ui-prototype";

const PERCENT_MAX = 100;
const FIXTURE = {
  placedAt: "2026-09-18", sourceWet: 250, sourceMoisture: 3, water: 50,
  ingredientWet: 100, ingredientMoisture: 30, requestedWet: 200,
  formulation: "blend" as const, destination: "A" as const,
};
const STOCK = { sourceWet: 500, sourceDry: 485, ingredientWet: 400, ingredientDry: 280, orderDry: 332.5 };
const BATCHES = [{ code: "DEMO-01", dry: 0 }, { code: "DEMO-02", dry: 90 }, { code: "DEMO-03", dry: 242.5 }];
const MASS_SCHEMA = requiredMassKgSchema();
const GRID = "grid grid-cols-1 gap-x-16 gap-y-20 sm:grid-cols-2";
type Mode = "product" | "order";
type NumberField = "sourceWet" | "sourceMoisture" | "water" | "ingredientWet" | "ingredientMoisture" | "requestedWet";

function MassRow({ label, mass, primary = false }: { label: string; mass: number; primary?: boolean }) {
  return (
    <div className={`flex justify-between gap-16 py-6 ${primary ? "body-large font-medium" : "body-small"}`}>
      <dt>{label}</dt><dd className="whitespace-nowrap tabular-nums">{formatMassKg(mass)}</dd>
    </div>
  );
}

function InlineDisclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group border-t border-[var(--hair-2)]">
      <summary className="flex min-h-44 cursor-pointer list-none items-center justify-between gap-12 py-12 body-small font-medium focus-visible:outline-2 focus-visible:outline-[var(--color-interaction)] [&::-webkit-details-marker]:hidden">
        <span><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span> {label}</span>
        <span aria-hidden className="body-large"><span className="group-open:hidden">+</span><span className="hidden group-open:inline">−</span></span>
      </summary>
      <div className="pb-16">{children}</div>
    </details>
  );
}

function StockRow({ label, before, after }: { label: string; before: number; after: number }) {
  return <tr className="border-t border-[var(--hair-3)]">
    <th scope="row" className="py-10 pr-12 text-left font-normal">{label}</th>
    <td className="whitespace-nowrap py-10 text-right tabular-nums">{formatMassKg(before)}</td>
    <td className="whitespace-nowrap py-10 pl-12 text-right tabular-nums">{formatMassKg(after)}</td>
  </tr>;
}

function OrderStockDetails() {
  const [includeEmpty, setIncludeEmpty] = useState(false);
  return <InlineDisclosure label="batch stock">
    <dl>{BATCHES.filter((batch) => includeEmpty || batch.dry > 0).map((batch) => <MassRow key={batch.code} label={batch.code} mass={batch.dry} />)}</dl>
    <label className="mt-8 flex min-h-44 cursor-pointer items-center gap-8 body-small">
      <input type="checkbox" checked={includeEmpty} onChange={(event) => setIncludeEmpty(event.target.checked)} />Include 1 empty batch
    </label>
  </InlineDisclosure>;
}

export function ProductOrderUiPrototype({ mode, standalone = false }: { mode: Mode; standalone?: boolean }) {
  const form = useForm({ resolver: zodResolver(productOrderPrototypeSchema), defaultValues: FIXTURE, mode: "onChange" });
  const values = useWatch({ control: form.control });
  const parsed = productOrderPrototypeSchema.safeParse(values);
  const data = parsed.success ? parsed.data : null;
  const isProduct = mode === "product";
  const isBlend = values.formulation === "blend";
  const ingredientWet = data && isBlend ? data.ingredientWet : 0;
  const dryBiochar = data ? data.sourceWet * (1 - data.sourceMoisture / PERCENT_MAX) : 0;
  const dryIngredient = data && isBlend ? ingredientWet * (1 - data.ingredientMoisture / PERCENT_MAX) : 0;
  const finalWet = data ? data.sourceWet + data.water + ingredientWet : 0;
  // Stock feedback must not disappear when an unrelated field is invalid.
  const sourceMass = MASS_SCHEMA.safeParse(values.sourceWet);
  const ingredientMass = MASS_SCHEMA.safeParse(values.ingredientWet);
  const sourceExceeded = sourceMass.success && sourceMass.data > STOCK.sourceWet;
  const ingredientExceeded = isBlend && ingredientMass.success && ingredientMass.data > STOCK.ingredientWet;
  const stockExceeded = isProduct && (sourceExceeded || ingredientExceeded);
  const [reviewed, setReviewed] = useState(false);

  function numberField(name: NumberField, label: string) {
    const moisture = name === "sourceMoisture" || name === "ingredientMoisture";
    const stockError = name === "sourceWet" && sourceExceeded
      ? `Available: ${formatMassKg(STOCK.sourceWet)} wet. Enter this amount or less.`
      : name === "ingredientWet" && ingredientExceeded
        ? `Available: ${formatMassKg(STOCK.ingredientWet)} wet. Enter this amount or less.` : undefined;
    return <FormField id={`prototype-${name}`} label={label} required hint={moisture ? MOISTURE_BASIS_HINT : undefined} error={stockError ?? form.formState.errors[name]?.message}>
      <FormInput id={`prototype-${name}`} type="number" step={moisture ? "any" : MASS_KG_INPUT_STEP} min={0} {...form.register(name)} />
    </FormField>;
  }

  const productSummary = <section aria-label="Product preview" className="space-y-12 border-t border-[var(--hair-2)] pt-16">
    {data && !stockExceeded ? <>
      <dl>
        <MassRow label="Wet product" mass={finalWet} primary />
        <MassRow label="Dry biochar" mass={dryBiochar} />
        {isBlend && <MassRow label="Ingredient dry solids" mass={dryIngredient} />}
      </dl>
      <div>
        <InlineDisclosure label="composition">
          <dl>
            <MassRow label="Dry biochar" mass={dryBiochar} />
            {isBlend && <MassRow label="Ingredient dry solids" mass={dryIngredient} />}
            <MassRow label="Water in product" mass={finalWet - dryBiochar - dryIngredient} />
          </dl>
        </InlineDisclosure>
        <InlineDisclosure label="stock changes">
          <table className="w-full body-small">
            <caption className="sr-only">Example stock before and after mixing</caption>
            <thead><tr className="text-[var(--color-text-secondary)]"><th scope="col" className="pb-8 text-left font-normal">Stock</th><th scope="col" className="pb-8 text-right font-normal">Before</th><th scope="col" className="pb-8 pl-12 text-right font-normal">After</th></tr></thead>
            <tbody>
              <StockRow label="Source wet" before={STOCK.sourceWet} after={STOCK.sourceWet - data.sourceWet} />
              <StockRow label="Source dry biochar" before={STOCK.sourceDry} after={STOCK.sourceDry - dryBiochar} />
              {isBlend && <><StockRow label="Ingredient wet" before={STOCK.ingredientWet} after={STOCK.ingredientWet - ingredientWet} /><StockRow label="Ingredient dry solids" before={STOCK.ingredientDry} after={STOCK.ingredientDry - dryIngredient} /></>}
              <StockRow label={`Product bin ${values.destination} wet`} before={0} after={finalWet} />
              <StockRow label="Product dry biochar" before={0} after={dryBiochar} />
            </tbody>
          </table>
        </InlineDisclosure>
      </div>
    </> : <p className="body-small text-[var(--color-text-secondary)]">Correct the highlighted quantities to see the product preview.</p>}
  </section>;

  return <div className="container-max page-shell">
    <div className="flex flex-wrap items-center justify-between gap-12 body-small">
      <p className="text-[var(--color-text-secondary)]">Prototype · nothing is saved</p>
      <nav aria-label="Prototype forms" className="flex flex-wrap gap-16">
        <Link className="underline underline-offset-4" aria-current={isProduct ? "page" : undefined} href="/biochar-products?prototype=stock">Product</Link>
        <Link className="underline underline-offset-4" aria-current={!isProduct ? "page" : undefined} href="/orders?prototype=stock">Order</Link>
        {!standalone && <Link className="underline underline-offset-4" href={isProduct ? "/biochar-products" : "/orders"}>Exit prototype</Link>}
      </nav>
    </div>
    <div className="w-full max-w-2xl space-y-24">
      <PageHeader title={isProduct ? "Create Biochar Product" : "Create Order"} />
      <form noValidate onSubmit={form.handleSubmit(() => setReviewed(true))} onChange={() => setReviewed(false)} className="min-w-0 space-y-20 border border-[var(--hair)] bg-[var(--paper)] p-16 sm:p-24">
        <FormSpine control={form.control}>
          <FormSection title={isProduct ? "Placement" : "Customer and location"} fields={isProduct ? ["placedAt"] : []}>
            {isProduct ? <FormField id="prototype-placed-at" label="Mixing and placement date" required error={form.formState.errors.placedAt?.message}><FormInput id="prototype-placed-at" type="date" {...form.register("placedAt")} /></FormField> : <div className={GRID}>
              <FormField id="prototype-customer" label="Customer"><FormSelect id="prototype-customer" options={[{ value: "demo", label: "Demo customer" }]} /></FormField>
              <FormField id="prototype-location" label="Delivery location"><FormSelect id="prototype-location" options={[{ value: "demo", label: "Demo farm" }]} /></FormField>
            </div>}
          </FormSection>
          <FormSection title={isProduct ? "Source" : "Product details"} fields={isProduct ? ["sourceWet", "sourceMoisture", "water"] : ["requestedWet"]}>
            {isProduct ? <>
              <FormField id="prototype-source" label="Source biochar"><FormSelect id="prototype-source" options={[{ value: "source", label: "Demo biochar bin · Maize cobs" }]} /></FormField>
              <div className={GRID}>{numberField("sourceWet", "Wet biochar mass (kg)")}{numberField("sourceMoisture", "Biochar moisture (%)")}</div>
              {numberField("water", "Water added (kg)")}
            </> : <>
              <FormField id="prototype-order-formulation" label="Formulation"><FormSelect id="prototype-order-formulation" options={[{ value: "bcf", label: "BCF" }]} /></FormField>
              {numberField("requestedWet", "Requested wet mass (kg)")}
              <section aria-label="Available stock" className="border-t border-[var(--hair-2)] pt-12">
                <p className="body-small"><strong>{formatMassKg(STOCK.orderDry)} dry biochar available</strong></p>
                <p className="mb-12 mt-4 body-caption text-[var(--color-text-secondary)]">BCF demo bin</p>
                <OrderStockDetails />
              </section>
            </>}
          </FormSection>
          {isProduct && <FormSection title="Formulation and ingredients" fields={isBlend ? ["formulation", "ingredientWet", "ingredientMoisture"] : ["formulation"]}>
            <FormField id="prototype-formulation" label="Formulation"><FormSelect id="prototype-formulation" {...form.register("formulation", { onChange: (event) => {
              if (event.target.value === "plain") form.clearErrors(["ingredientWet", "ingredientMoisture"]);
            } })} options={[{ value: "blend", label: "Chicken manure 50/50" }, { value: "plain", label: "Unblended biochar" }]} /></FormField>
            {isBlend && <>
              <FormField id="prototype-ingredient" label="Ingredient bin"><FormSelect id="prototype-ingredient" options={[{ value: "manure", label: "Demo chicken manure bin" }]} /></FormField>
              <div className={GRID}>{numberField("ingredientWet", "Ingredient wet mass (kg)")}{numberField("ingredientMoisture", "Ingredient moisture (%)")}</div>
            </>}
          </FormSection>}
          {isProduct && <FormSection title="Product bin" fields={["destination"]}>
            <fieldset className="space-y-8">
              <legend className="mb-8 body-small">Destination bin</legend>
              <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
                {(["A", "B"] as const).map((bin) => <label key={bin} className="flex min-h-44 cursor-pointer items-center gap-12 border border-[var(--hair-2)] px-12 py-8 has-[:checked]:border-[var(--color-interaction)] has-[:checked]:bg-[var(--color-surface-light)] focus-within:outline-2 focus-within:outline-[var(--color-interaction)]">
                  <input type="radio" value={bin} {...form.register("destination")} /><span className="body-small">Product bin {bin}<span className="ml-8 text-[var(--color-text-secondary)]">Empty</span></span>
                </label>)}
              </div>
            </fieldset>
            {productSummary}
          </FormSection>}
        </FormSpine>
        {reviewed && <p role="status" className="body-small">{isProduct ? "Product" : "Order"} preview reviewed. Nothing was saved.</p>}
        <div className="[&>div>div]:flex-wrap">
          <FormActions sticky={false} submitLabel={isProduct ? "Review product" : "Review order"} submitDisabled={stockExceeded} onCancel={() => { form.reset(); setReviewed(false); }} cancelLabel="Reset example" />
        </div>
      </form>
    </div>
  </div>;
}
