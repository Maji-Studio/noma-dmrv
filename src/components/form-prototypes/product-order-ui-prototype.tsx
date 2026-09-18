"use client";

/** Three throwaway form variants on the existing protected routes, via ?prototype=stock&variant=A|B|C. */
import { useState } from "react";
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
import { MASS_KG_INPUT_STEP } from "@/schemas/helpers";
import { productOrderPrototypeSchema } from "@/schemas/product-order-ui-prototype";
import { PrototypeSwitcher } from "./prototype-switcher";
import { PROTOTYPE_NAMES, type PrototypeVariant } from "./prototype-variants";

const PERCENT_MAX = 100;
const FIXTURE = {
  placedAt: "2026-09-18", sourceWet: 250, sourceMoisture: 3, water: 50,
  ingredientWet: 100, ingredientMoisture: 30, requestedWet: 200,
  formulation: "blend" as const, destination: "A" as const,
};
const STOCK = { sourceWet: 500, sourceDry: 485, ingredientWet: 400, ingredientDry: 280, orderDry: 332.5 };
const BATCHES = [{ code: "DEMO-01", dry: 0 }, { code: "DEMO-02", dry: 90 }, { code: "DEMO-03", dry: 242.5 }];
const grid = "grid grid-cols-1 gap-x-16 gap-y-20 sm:grid-cols-2";
const panel = "min-w-0 border border-[var(--hair)] bg-[var(--paper)] p-24";
const summaryClass = "min-h-44 cursor-pointer py-12 body-small font-medium";

type Mode = "product" | "order";
type NumberField = "sourceWet" | "sourceMoisture" | "water" | "ingredientWet" | "ingredientMoisture" | "requestedWet";

function MassRow({ label, mass }: { label: string; mass: number }) {
  return <div className="flex justify-between gap-16 border-b border-[var(--hair-3)] py-8 body-small"><span>{label}</span><span className="whitespace-nowrap tabular-nums">{formatMassKg(mass)}</span></div>;
}

function OrderStockDetails() {
  const [includeEmpty, setIncludeEmpty] = useState(false);
  return <div className="space-y-12">
    <p className="label-micro">BCF demo bin · dry biochar</p>
    {BATCHES.filter((batch) => includeEmpty || batch.dry > 0).map((batch) => <MassRow key={batch.code} label={batch.code} mass={batch.dry} />)}
    <label className="flex min-h-44 items-center gap-8 body-small"><input type="checkbox" checked={includeEmpty} onChange={(event) => setIncludeEmpty(event.target.checked)} />Show empty batches</label>
  </div>;
}

export function ProductOrderUiPrototype({ mode, variant, standalone = false }: { mode: Mode; variant: PrototypeVariant; standalone?: boolean }) {
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
  const stockExceeded = !!data && (data.sourceWet > STOCK.sourceWet || ingredientWet > STOCK.ingredientWet);
  const [reviewed, setReviewed] = useState(false);

  function numberField(name: NumberField, label: string) {
    return <FormField id={`prototype-${name}`} label={label} error={form.formState.errors[name]?.message}>
      <FormInput id={`prototype-${name}`} type="number" step={name === "sourceMoisture" || name === "ingredientMoisture" ? "any" : MASS_KG_INPUT_STEP} min={0} {...form.register(name)} />
    </FormField>;
  }
  const detail = isProduct ? <div className="space-y-20">
    <div><p className="label-micro">Product composition</p><MassRow label="Dry biochar" mass={dryBiochar} /><MassRow label="Ingredient dry solids" mass={dryIngredient} /><MassRow label="Water in final product" mass={finalWet - dryBiochar - dryIngredient} /></div>
    <div><p className="label-micro">Stock before → after</p>
      <p className="body-small py-8">Source biochar: {formatMassKg(STOCK.sourceWet)} → {formatMassKg(STOCK.sourceWet - (data?.sourceWet ?? 0))} wet</p>
      <p className="body-small py-8">Source biochar: {formatMassKg(STOCK.sourceDry)} → {formatMassKg(STOCK.sourceDry - dryBiochar)} dry</p>
      {isBlend && <><p className="body-small py-8">Ingredient: {formatMassKg(STOCK.ingredientWet)} → {formatMassKg(STOCK.ingredientWet - ingredientWet)} wet</p><p className="body-small py-8">Ingredient solids: {formatMassKg(STOCK.ingredientDry)} → {formatMassKg(STOCK.ingredientDry - dryIngredient)} dry</p></>}
      <p className="body-small py-8">Product bin {values.destination}: 0 kg → {formatMassKg(finalWet)} wet</p>
      <p className="body-small py-8">Product dry biochar: 0 kg → {formatMassKg(dryBiochar)}</p>
    </div>
  </div> : <OrderStockDetails />;
  const headline = isProduct ? <><strong>{formatMassKg(finalWet)} wet product</strong><span className="body-small">{formatMassKg(dryBiochar)} dry biochar{isBlend ? ` · ${formatMassKg(dryIngredient)} ingredient dry solids` : ""}</span></> : <><strong>{formatMassKg(STOCK.orderDry)} dry biochar available</strong><span className="body-small">BCF demo bin · 2 batches with stock</span></>;
  const summary = <div className="flex flex-col gap-4">{data ? headline : <p className="body-small">Enter valid masses and moisture percentages to view the preview.</p>}</div>;
  const disclosure = <details className="border-t border-[var(--hair-2)]"><summary className={summaryClass}>{isProduct ? "Composition and stock changes" : "View batch stock"}</summary>{data && detail}</details>;

  const inputs = <FormSpine control={form.control}>
    <FormSection title={isProduct ? "Placement" : "Customer and location"} fields={isProduct ? ["placedAt"] : []}>
      {isProduct ? <FormField id="prototype-placed-at" label="Mixing and placement date" required error={form.formState.errors.placedAt?.message}><FormInput id="prototype-placed-at" type="date" {...form.register("placedAt")} /></FormField> : <div className={grid}><FormField id="prototype-customer" label="Customer"><FormSelect id="prototype-customer" options={[{ value: "demo", label: "Demo customer" }]} /></FormField><FormField id="prototype-location" label="Delivery location"><FormSelect id="prototype-location" options={[{ value: "demo", label: "Demo farm" }]} /></FormField></div>}
    </FormSection>
    <FormSection title={isProduct ? "Source" : "Product details"} fields={isProduct ? ["sourceWet", "sourceMoisture", "water"] : ["requestedWet"]}>
      {isProduct ? <><FormField id="prototype-source" label="Source biochar"><FormSelect id="prototype-source" options={[{ value: "source", label: "Demo biochar bin · Maize cobs" }]} /></FormField><div className={grid}>{numberField("sourceWet", "Wet biochar mass (kg)")}{numberField("sourceMoisture", "Biochar moisture (%)")}</div>{numberField("water", "Water added (kg)")}{variant === "C" && data && <MassRow label="Dry biochar from source" mass={dryBiochar} />}</> : <><FormField id="prototype-order-formulation" label="Formulation"><FormSelect id="prototype-order-formulation" options={[{ value: "bcf", label: "BCF" }]} /></FormField>{numberField("requestedWet", "Requested wet mass (kg)")}{variant === "C" && <div className="space-y-12">{summary}{disclosure}</div>}</>}
    </FormSection>
    {isProduct && <FormSection title="Formulation and ingredients" fields={isBlend ? ["formulation", "ingredientWet", "ingredientMoisture"] : ["formulation"]}>
      <FormField id="prototype-formulation" label="Formulation"><FormSelect id="prototype-formulation" {...form.register("formulation", { onChange: (event) => {
        if (event.target.value === "plain") form.clearErrors(["ingredientWet", "ingredientMoisture"]);
      } })} options={[{ value: "blend", label: "Chicken manure 50/50" }, { value: "plain", label: "Unblended biochar" }]} /></FormField>
      {isBlend && <><FormField id="prototype-ingredient" label="Ingredient bin"><FormSelect id="prototype-ingredient" options={[{ value: "manure", label: "Demo chicken manure bin" }]} /></FormField><div className={grid}>{numberField("ingredientWet", "Ingredient wet mass (kg)")}{numberField("ingredientMoisture", "Ingredient moisture (%)")}</div>{variant === "C" && data && <MassRow label="Ingredient dry solids" mass={dryIngredient} />}</>}
    </FormSection>}
    {isProduct && <FormSection title="Product bin" fields={["destination"]}><fieldset className="space-y-8"><legend className="body-small mb-8">Choose the destination bin</legend>{(["A", "B"] as const).map((bin) => <label key={bin} className="flex min-h-44 cursor-pointer items-center gap-12 border border-[var(--hair-2)] px-12"><input type="radio" value={bin} {...form.register("destination")} /><span className="body-small">Product bin {bin} · Empty</span></label>)}</fieldset>{variant === "C" && <div className="space-y-12">{summary}{disclosure}</div>}</FormSection>}
  </FormSpine>;

  return <div className="h-[calc(100dvh-var(--spacing-160))] overflow-y-auto md:h-[calc(100dvh-var(--spacing-96))]">
    <div className="container-max page-shell">
    <PageHeader area={isProduct ? "production" : "distribution"} eyebrow="PROTOTYPE · synthetic data" title={isProduct ? "Create Biochar Product" : "Create Order"} subtitle={`${variant} · ${PROTOTYPE_NAMES[variant]}. Explore the layout. Nothing is saved.`} />
    <div className="flex flex-wrap items-center gap-16 body-small"><Link className="underline" href={`/biochar-products?prototype=stock&variant=${variant}`}>Product prototype</Link><Link className="underline" href={`/orders?prototype=stock&variant=${variant}`}>Order prototype</Link>{!standalone && <Link className="underline" href={isProduct ? "/biochar-products" : "/orders"}>Exit prototype</Link>}</div>
    <form onSubmit={form.handleSubmit(() => setReviewed(true))} onChange={() => setReviewed(false)} className={variant === "B" ? "grid min-w-0 grid-cols-1 items-start gap-24 lg:grid-cols-3" : "mx-auto w-full max-w-2xl"}>
      <div className={`${panel} space-y-20 ${variant === "B" ? "lg:col-span-2" : ""}`}>
        {inputs}
        {stockExceeded && <p role="alert" className="body-small text-[var(--st-bad)]">Reduce the source or ingredient wet mass to the available demo stock.</p>}
        {variant === "A" && <section aria-label="Preview" className="space-y-12 border-t border-[var(--hair)] pt-16">{summary}{disclosure}</section>}
        {variant !== "B" && <><p role="status" className="body-small">{reviewed ? "Preview reviewed. No record was created." : ""}</p><div className="[&>div>div]:flex-wrap"><FormActions sticky={false} submitLabel="Review prototype" submitDisabled={stockExceeded} onCancel={() => { form.reset(); setReviewed(false); }} cancelLabel="Reset example" /></div></>}
      </div>
      {variant === "B" && <aside aria-label="Review" className={`${panel} space-y-20 lg:sticky lg:top-24`}><h2 className="title-heading-3">Review</h2>{summary}{disclosure}<p role="status" className="body-small">{reviewed ? "Preview reviewed. No record was created." : ""}</p><div className="[&>div>div]:flex-wrap"><FormActions sticky={false} submitLabel="Review prototype" submitDisabled={stockExceeded} onCancel={() => { form.reset(); setReviewed(false); }} cancelLabel="Reset example" /></div></aside>}
    </form>
    <details className="body-small"><summary className={summaryClass}>Prototype state and assumptions</summary><p>Layout exploration only. Example quantities are synthetic and do not enforce formulation ratios or model FIFO. Existing accounting and order behavior are unchanged.</p><pre className="mt-12 overflow-auto">{JSON.stringify({ mode, variant, inputs: values, previewValid: !!data, stockExceeded }, null, 2)}</pre></details>
    </div>
    <PrototypeSwitcher variant={variant} />
  </div>;
}
