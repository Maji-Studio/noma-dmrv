"use client";

/** Throwaway inline design on existing protected routes, via ?prototype=stock. */
import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { VariantSections, VariantSwitcher, readVariant, type PrototypeSection } from "./variant-layout";
import { Calculation, CalculationDisclosure, Disclosure, Facts, MaterialReadout } from "./mass-readouts";
import { derivedMass } from "./mass-format";
import { Composition, type MassSegment } from "./composition-visuals";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/ui";
import { FormInput } from "@/components/forms/form-input";
import { FormSelect } from "@/components/forms/form-select";
import { FormField } from "@/components/forms/form-field";
import { FormActions } from "@/components/forms/form-actions";
import { formatMassKg } from "@/lib/format-utils";
import { MOISTURE_BASIS_HINT, parseWatchedNumber, splitWetMass } from "@/lib/mass-moisture";
import { MASS_KG_INPUT_STEP, requiredMassKgSchema } from "@/schemas/helpers";
import { productOrderPrototypeSchema } from "@/schemas/product-order-ui-prototype";

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

function StockRow({ label, before, after }: { label: string; before: number; after: number | null }) {
  return <tr className="border-t border-[var(--hair-3)]">
    <th scope="row" className="py-10 pr-12 text-left font-normal">{label}</th>
    <td className="whitespace-nowrap py-10 text-right tabular-nums">{formatMassKg(before)}</td>
    <td className="whitespace-nowrap py-10 pl-12 text-right tabular-nums">{derivedMass(after)}</td>
  </tr>;
}

function OrderStockDetails() {
  const [includeEmpty, setIncludeEmpty] = useState(false);
  return <Disclosure label="Batch stock">
    <Facts facts={BATCHES.filter((batch) => includeEmpty || batch.dry > 0).map((batch) => ({ label: `${batch.code} dry biochar`, mass: batch.dry }))} />
    <label className="mt-8 flex min-h-44 cursor-pointer items-center gap-8 body-small">
      <input type="checkbox" checked={includeEmpty} onChange={(event) => setIncludeEmpty(event.target.checked)} />Include 1 empty batch
    </label>
  </Disclosure>;
}

function massValue(value: unknown) {
  const result = MASS_SCHEMA.safeParse(value);
  return result.success ? result.data : null;
}

function remaining(before: number, used: number | null) {
  return used !== null && used <= before ? before - used : null;
}

export function ProductOrderUiPrototype(props: { mode: Mode; standalone?: boolean }) {
  return <PrototypeForm key={props.mode} {...props} />;
}

function PrototypeForm({ mode, standalone = false }: { mode: Mode; standalone?: boolean }) {
  const variant = readVariant(useSearchParams().get("variant"));
  const pathname = usePathname();
  const form = useForm({ resolver: zodResolver(productOrderPrototypeSchema), defaultValues: FIXTURE, mode: "onChange" });
  const values = useWatch({ control: form.control });
  const isProduct = mode === "product";
  const isBlend = values.formulation === "blend";
  const sourceWet = massValue(values.sourceWet);
  const ingredientWet = isBlend ? massValue(values.ingredientWet) : 0;
  const water = massValue(values.water);
  const sourceSplit = splitWetMass(sourceWet, parseWatchedNumber(values.sourceMoisture));
  const ingredientSplit = isBlend ? splitWetMass(ingredientWet, parseWatchedNumber(values.ingredientMoisture)) : splitWetMass(0, 0);
  const dryBiochar = sourceSplit?.dryKg ?? null;
  const dryIngredient = ingredientSplit?.dryKg ?? null;
  const finalWet = sourceWet !== null && ingredientWet !== null && water !== null ? sourceWet + ingredientWet + water : null;
  const totalDry = dryBiochar !== null && dryIngredient !== null ? dryBiochar + dryIngredient : null;
  const existingWater = sourceSplit && ingredientSplit ? sourceSplit.waterKg + ingredientSplit.waterKg : null;
  // Each material and basis is checked independently of unrelated form errors.
  const sourceExceeded = sourceWet !== null && sourceWet > STOCK.sourceWet;
  const sourceDryExceeded = dryBiochar !== null && dryBiochar > STOCK.sourceDry;
  const ingredientExceeded = isBlend && ingredientWet !== null && ingredientWet > STOCK.ingredientWet;
  const ingredientDryExceeded = isBlend && dryIngredient !== null && dryIngredient > STOCK.ingredientDry;
  const stockExceeded = isProduct && (sourceExceeded || sourceDryExceeded || ingredientExceeded || ingredientDryExceeded);
  const [reviewed, setReviewed] = useState(false);

  function numberField(name: NumberField, label: string) {
    const moisture = name === "sourceMoisture" || name === "ingredientMoisture";
    const stockError = name === "sourceWet" && sourceExceeded
      ? `Available: ${formatMassKg(STOCK.sourceWet)} wet. Enter this amount or less.`
      : name === "ingredientWet" && ingredientExceeded
        ? `Available: ${formatMassKg(STOCK.ingredientWet)} wet. Enter this amount or less.` : name === "sourceMoisture" && sourceDryExceeded
          ? `Dry biochar exceeds ${formatMassKg(STOCK.sourceDry)} available. Reduce wet mass or correct moisture.`
          : name === "ingredientMoisture" && ingredientDryExceeded
            ? `Ingredient dry solids exceed ${formatMassKg(STOCK.ingredientDry)} available. Reduce wet mass or correct moisture.` : undefined;
    return <FormField id={`prototype-${name}`} label={label} required hint={moisture ? MOISTURE_BASIS_HINT : undefined} error={stockError ?? form.formState.errors[name]?.message}>
      <FormInput className="min-h-44" aria-invalid={Boolean(stockError ?? form.formState.errors[name])} id={`prototype-${name}`} type="number" step={moisture ? "any" : MASS_KG_INPUT_STEP} min={0} {...form.register(name)} />
    </FormField>;
  }

  const productSegments: MassSegment[] = [
    { label: "Dry biochar", mass: dryBiochar, category: "dry-biochar" },
    ...(isBlend ? [{ label: "Ingredient dry solids", mass: dryIngredient, category: "ingredient-solids" as const }] : []),
    { label: "Existing water", mass: existingWater, category: "existing-water" },
    { label: "Added water", mass: water, category: "added-water" },
  ];
  const productSummary = <section aria-label="Product mass" className="space-y-12">
    <div>
      <Composition variant={variant} label="Wet product composition" totalLabel="Wet product" total={finalWet} segments={productSegments} />
      <CalculationDisclosure context="product">
        <Calculation split={sourceSplit} label="Dry biochar" />
        {isBlend && <Calculation split={ingredientSplit} label="Ingredient dry solids" />}
        <p>Wet product: {derivedMass(sourceWet)} + {derivedMass(ingredientWet)} + {derivedMass(water)} ≈ {derivedMass(finalWet)}</p>
        <p>Total dry solids: {derivedMass(dryBiochar)} + {derivedMass(dryIngredient)} ≈ {derivedMass(totalDry)}</p>
        <p>Existing water: {derivedMass(sourceSplit?.waterKg ?? null)} + {derivedMass(ingredientSplit?.waterKg ?? null)} ≈ {derivedMass(existingWater)}</p>
        <p>Composition sum: {productSegments.map((segment) => derivedMass(segment.mass)).join(" + ")} ≈ {derivedMass(finalWet)}</p>
      </CalculationDisclosure>
    </div>
    <Disclosure label="Stock before and after">
      <table className="w-full body-small">
        <caption className="sr-only">Synthetic stock before and after mixing</caption>
        <thead><tr><th scope="col" className="pb-8 text-left font-normal">Stock</th><th scope="col" className="pb-8 text-right font-normal">Before</th><th scope="col" className="pb-8 pl-12 text-right font-normal">After</th></tr></thead>
        <tbody>
          <StockRow label="Source wet" before={STOCK.sourceWet} after={remaining(STOCK.sourceWet, sourceWet)} />
          <StockRow label="Source dry biochar" before={STOCK.sourceDry} after={remaining(STOCK.sourceDry, dryBiochar)} />
          {isBlend && <><StockRow label="Ingredient wet" before={STOCK.ingredientWet} after={remaining(STOCK.ingredientWet, ingredientWet)} /><StockRow label="Ingredient dry solids" before={STOCK.ingredientDry} after={remaining(STOCK.ingredientDry, dryIngredient)} /></>}
          <StockRow label={`Product bin ${values.destination} wet`} before={0} after={stockExceeded ? null : finalWet} />
          <StockRow label="Product dry biochar" before={0} after={stockExceeded ? null : dryBiochar} />
        </tbody>
      </table>
    </Disclosure>
  </section>;
  const orderSummary = <section aria-label="Order mass" className="space-y-12">
    <Facts facts={[{ label: "Requested wet", mass: massValue(values.requestedWet) }]} />
    <div>
      <Composition variant={variant} label="Available dry biochar by batch" totalLabel="Available dry biochar" total={STOCK.orderDry} dryOnly segments={BATCHES.map((batch) => ({ label: batch.code, mass: batch.dry, category: "dry-batch" }))} />
      <CalculationDisclosure context="order">
        <p>Available dry biochar: {BATCHES.map((batch) => `${batch.code} (${formatMassKg(batch.dry)})`).join(" + ")} ≈ {formatMassKg(STOCK.orderDry)}</p>
        <p>Requested wet is entered directly. No moisture is recorded for conversion to dry mass.</p>
      </CalculationDisclosure>
    </div>
    <OrderStockDetails />
  </section>;
  const placement = isProduct
    ? <FormField id="prototype-placed-at" label="Mixing and placement date" required error={form.formState.errors.placedAt?.message}><FormInput id="prototype-placed-at" type="date" {...form.register("placedAt")} /></FormField>
    : <div className={GRID}>
      <FormField id="prototype-customer" label="Customer"><FormSelect id="prototype-customer" options={[{ value: "demo", label: "Demo customer" }]} /></FormField>
      <FormField id="prototype-location" label="Delivery location"><FormSelect id="prototype-location" options={[{ value: "demo", label: "Demo farm" }]} /></FormField>
    </div>;
  const source = <>
    <FormField id="prototype-source" label="Source biochar"><FormSelect id="prototype-source" options={[{ value: "source", label: "Demo biochar bin · Maize cobs" }]} /></FormField>
    <div className={GRID}>{numberField("sourceWet", "Wet biochar mass (kg)")}{numberField("sourceMoisture", "Biochar moisture (%)")}</div>
    <MaterialReadout variant={variant} wet={sourceWet} split={sourceSplit} dryLabel="Dry biochar" category="dry-biochar" context="Source" />
    {numberField("water", "Water added (kg)")}
  </>;
  const ingredients = <>
    <FormField id="prototype-formulation" label="Formulation"><FormSelect id="prototype-formulation" {...form.register("formulation", { onChange: (event) => {
      if (event.target.value === "plain") form.clearErrors(["ingredientWet", "ingredientMoisture"]);
    } })} options={[{ value: "blend", label: "Chicken manure 50/50" }, { value: "plain", label: "Unblended biochar" }]} /></FormField>
    {isBlend && <>
      <FormField id="prototype-ingredient" label="Ingredient bin"><FormSelect id="prototype-ingredient" options={[{ value: "manure", label: "Demo chicken manure bin" }]} /></FormField>
      <div className={GRID}>{numberField("ingredientWet", "Ingredient wet mass (kg)")}{numberField("ingredientMoisture", "Ingredient moisture (%)")}</div>
      <MaterialReadout variant={variant} wet={ingredientWet} split={ingredientSplit} dryLabel="Ingredient dry solids" category="ingredient-solids" context="Ingredient" />
    </>}
  </>;
  const destination = <fieldset className="space-y-8">
    <legend className="mb-8 body-small">Destination bin</legend>
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
      {(["A", "B"] as const).map((bin) => <label key={bin} className="flex min-h-44 cursor-pointer items-center gap-12 border border-[var(--hair-2)] px-12 py-8 has-[:checked]:border-[var(--color-interaction)] has-[:checked]:bg-[var(--color-surface-light)] focus-within:outline-2 focus-within:outline-[var(--color-interaction)]">
        <input type="radio" value={bin} {...form.register("destination")} /><span className="body-small">Product bin {bin}<span className="ml-8 text-[var(--color-text-secondary)]">Empty</span></span>
      </label>)}
    </div>
  </fieldset>;
  const orderFormulation = <FormField id="prototype-order-formulation" label="Formulation"><FormSelect id="prototype-order-formulation" options={[{ value: "bcf", label: "BCF" }]} /></FormField>;
  const sections: PrototypeSection[] = isProduct ? [
    { id: "placement", title: "Placement", content: placement },
    { id: "source", title: "Source", content: source },
    { id: "ingredients", title: "Formulation and ingredients", content: ingredients },
    { id: "destination", title: "Product bin", content: destination },
  ] : [
    { id: "customer", title: "Customer and location", content: placement },
    { id: "formulation", title: "Formulation", content: orderFormulation },
    { id: "amount", title: "Requested amount", content: numberField("requestedWet", "Requested wet mass (kg)") },
  ];
  function resetExample() {
    form.reset(); setReviewed(false);
  }

  return <div className="container-max page-shell [&_button]:normal-case! [&_h3]:normal-case [&_h3]:tracking-normal">
    <div className="flex flex-wrap items-center justify-between gap-12 body-small">
      <p className="text-[var(--color-text-secondary)]">Prototype · nothing is saved</p>
      <nav aria-label="Prototype forms" className="flex flex-wrap gap-16">
        <Link className="inline-flex min-h-44 items-center underline underline-offset-4" aria-current={isProduct ? "page" : undefined} href={`/biochar-products?prototype=stock&variant=${variant}`}>Product</Link>
        <Link className="inline-flex min-h-44 items-center underline underline-offset-4" aria-current={!isProduct ? "page" : undefined} href={`/orders?prototype=stock&variant=${variant}`}>Order</Link>
        {!standalone && <Link className="underline underline-offset-4" href={isProduct ? "/biochar-products" : "/orders"}>Exit prototype</Link>}
      </nav>
    </div>
    <div className="w-full max-w-2xl space-y-24">
      <PageHeader title={isProduct ? "Create biochar product" : "Create order"} />
      <VariantSwitcher variant={variant} onChange={(next) => {
        const url = `${pathname}?prototype=stock&variant=${next}`;
        window.history.pushState(null, "", url);
        // The standalone navigation shim subscribes to popstate; Next also tracks native history.
        window.dispatchEvent(new PopStateEvent("popstate"));
        setReviewed(false);
      }} />
      <form noValidate onSubmit={(event) => {
        void form.handleSubmit(() => {
          if (!stockExceeded) {
            setReviewed(true);
          }
        }, () => setReviewed(false))(event);
      }} onChange={() => setReviewed(false)} className="min-w-0 space-y-20 border border-[var(--hair)] bg-[var(--paper)] p-16 sm:p-24 [&_input]:min-h-44 [&_select]:min-h-44 [&_button]:min-h-44 [&_input[type=radio]]:min-h-0 [&_input[type=checkbox]]:min-h-0">
        <VariantSections sections={sections} />
        <section aria-label="Inline review" className="space-y-12 border-t border-[var(--hair-2)] pt-16">
          <h2 className="body-large font-medium">{isProduct ? "Product mass" : "Order mass"}</h2>
          {isProduct ? productSummary : orderSummary}
        </section>
        {reviewed && <p role="status" className="body-small">{isProduct ? "Product" : "Order"} preview reviewed. Nothing was saved.</p>}
        <div className="[&>div>div]:flex-wrap">
          <FormActions sticky={false} submitLabel="Review" onCancel={resetExample} cancelLabel="Reset example" />
        </div>
      </form>
    </div>
  </div>;
}
