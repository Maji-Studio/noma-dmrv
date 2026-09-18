"use client";

/** Throwaway inline design on existing protected routes, via ?prototype=stock. */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { VariantSections, VariantSwitcher, readVariant, type PrototypeSection } from "./variant-layout";
import type { ProductOrderPrototypeInput } from "@/schemas/product-order-ui-prototype";
import { formatDate } from "@/lib/format-utils";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PageHeader } from "@/components/ui";
import { FormInput } from "@/components/forms/form-input";
import { FormSelect } from "@/components/forms/form-select";
import { FormField } from "@/components/forms/form-field";
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

function InlineDisclosure({ label, children, expanded = false }: { label: string; children: ReactNode; expanded?: boolean }) {
  return (
    <details open={expanded || undefined} className="group border-t border-[var(--hair-2)]">
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

function OrderStockDetails({ expanded = false }: { expanded?: boolean }) {
  const [includeEmpty, setIncludeEmpty] = useState(false);
  return <InlineDisclosure label="batch stock" expanded={expanded}>
    <dl>{BATCHES.filter((batch) => includeEmpty || batch.dry > 0).map((batch) => <MassRow key={batch.code} label={batch.code} mass={batch.dry} />)}</dl>
    <label className="mt-8 flex min-h-44 cursor-pointer items-center gap-8 body-small">
      <input type="checkbox" checked={includeEmpty} onChange={(event) => setIncludeEmpty(event.target.checked)} />Include 1 empty batch
    </label>
  </InlineDisclosure>;
}

export function ProductOrderUiPrototype(props: { mode: Mode; standalone?: boolean }) {
  return <PrototypeForm key={props.mode} {...props} />;
}

function PrototypeForm({ mode, standalone = false }: { mode: Mode; standalone?: boolean }) {
  const variant = readVariant(useSearchParams().get("variant"));
  const pathname = usePathname();
  const [step, setStep] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
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
      <FormInput className="min-h-44" aria-invalid={Boolean(stockError ?? form.formState.errors[name])} id={`prototype-${name}`} type="number" step={moisture ? "any" : MASS_KG_INPUT_STEP} min={0} {...form.register(name)} />
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
        <InlineDisclosure label="composition" expanded={variant === "E"}>
          <dl>
            <MassRow label="Dry biochar" mass={dryBiochar} />
            {isBlend && <MassRow label="Ingredient dry solids" mass={dryIngredient} />}
            <MassRow label="Water in product" mass={finalWet - dryBiochar - dryIngredient} />
          </dl>
        </InlineDisclosure>
        <InlineDisclosure label="stock changes" expanded={variant === "E"}>
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

  const orderStock = <section aria-label="Available stock" className="space-y-8 border-t border-[var(--hair-2)] pt-12">
    <p className="body-small"><strong>{formatMassKg(STOCK.orderDry)} dry biochar available</strong></p>
    <p className="body-caption text-[var(--color-text-secondary)]">BCF demo bin</p>
    <OrderStockDetails expanded={variant === "E"} />
  </section>;
  const orderSummary = <section aria-label="Order preview" className="space-y-16">
    <p className="body-small">Demo customer / Demo farm / BCF</p>
    <dl><MassRow label="Requested wet mass" mass={MASS_SCHEMA.safeParse(values.requestedWet).success ? Number(values.requestedWet) : NaN} primary /></dl>
    {orderStock}
  </section>;
  function stockAtField(label: string, available: number, entered: typeof sourceMass, dry: number) {
    return <div className="border-l-2 border-[var(--color-interaction)] pl-16 body-small">
      <p>{label}: {formatMassKg(available)} wet available</p>
      {entered.success && entered.data <= available && <p>{formatMassKg(available - entered.data)} wet remaining after mixing</p>}
      {data && <p>{formatMassKg(dry)} dry {label === "Source" ? "biochar" : "solids"} in this product</p>}
    </div>;
  }
  const placement = isProduct
    ? <FormField id="prototype-placed-at" label="Mixing and placement date" required error={form.formState.errors.placedAt?.message}><FormInput id="prototype-placed-at" type="date" {...form.register("placedAt")} /></FormField>
    : <div className={GRID}>
      <FormField id="prototype-customer" label="Customer"><FormSelect id="prototype-customer" options={[{ value: "demo", label: "Demo customer" }]} /></FormField>
      <FormField id="prototype-location" label="Delivery location"><FormSelect id="prototype-location" options={[{ value: "demo", label: "Demo farm" }]} /></FormField>
    </div>;
  const source = <>
    <FormField id="prototype-source" label="Source biochar"><FormSelect id="prototype-source" options={[{ value: "source", label: "Demo biochar bin · Maize cobs" }]} /></FormField>
    <div className={GRID}>{numberField("sourceWet", "Wet biochar mass (kg)")}{numberField("sourceMoisture", "Biochar moisture (%)")}</div>
    {variant === "B" && stockAtField("Source", STOCK.sourceWet, sourceMass, dryBiochar)}
    {numberField("water", "Water added (kg)")}
    {variant === "B" && <p className="body-small text-[var(--color-text-secondary)]">Added water increases wet product mass. Dry biochar stays the same.</p>}
  </>;
  const ingredients = <>
    <FormField id="prototype-formulation" label="Formulation"><FormSelect id="prototype-formulation" {...form.register("formulation", { onChange: (event) => {
      if (event.target.value === "plain") form.clearErrors(["ingredientWet", "ingredientMoisture"]);
    } })} options={[{ value: "blend", label: "Chicken manure 50/50" }, { value: "plain", label: "Unblended biochar" }]} /></FormField>
    {isBlend && <>
      <FormField id="prototype-ingredient" label="Ingredient bin"><FormSelect id="prototype-ingredient" options={[{ value: "manure", label: "Demo chicken manure bin" }]} /></FormField>
      <div className={GRID}>{numberField("ingredientWet", "Ingredient wet mass (kg)")}{numberField("ingredientMoisture", "Ingredient moisture (%)")}</div>
      {variant === "B" && stockAtField("Ingredient", STOCK.ingredientWet, ingredientMass, dryIngredient)}
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
  const sections: PrototypeSection[] = (isProduct ? [
    { id: "placement", title: "Placement", fields: ["placedAt"], summary: formatDate(values.placedAt), content: placement },
    { id: "source", title: "Source", fields: ["sourceWet", "sourceMoisture", "water"], summary: `${formatMassKg(sourceMass.success ? sourceMass.data : null)} wet biochar`, content: source },
    { id: "ingredients", title: "Formulation and ingredients", fields: isBlend ? ["formulation", "ingredientWet", "ingredientMoisture"] : ["formulation"], summary: isBlend ? `Chicken manure 50/50 / ${formatMassKg(ingredientMass.success ? ingredientMass.data : null)} wet ingredient` : "Unblended biochar", content: ingredients },
    { id: "destination", title: "Product bin", fields: ["destination"], summary: `Product bin ${values.destination}`, content: <>{destination}{variant === "B" && productSummary}</> },
  ] : [
    { id: "customer", title: "Customer and location", fields: [], summary: "Demo customer / Demo farm", content: placement },
    { id: "formulation", title: "Formulation", fields: [], summary: `BCF / ${formatMassKg(STOCK.orderDry)} dry biochar available`, content: <>{orderFormulation}{variant === "B" && orderStock}</> },
    { id: "amount", title: "Requested amount", fields: ["requestedWet"], summary: `${formatMassKg(MASS_SCHEMA.safeParse(values.requestedWet).success ? Number(values.requestedWet) : null)} wet requested`, content: numberField("requestedWet", "Requested wet mass (kg)") },
  ]).map((section) => ({ ...section, hasError: section.fields.some((field) => Boolean(form.formState.errors[field as keyof ProductOrderPrototypeInput])) || (section.id === "source" && sourceExceeded) || (section.id === "ingredients" && ingredientExceeded) }));
  const lastStep = sections.length;
  const isGuided = variant === "D";
  const atReview = !isGuided || step >= lastStep;
  const showSummary = variant === "A" || variant === "C" || (isGuided && atReview) || (variant === "E" && reviewOpen);

  async function continueStep() {
    const fields = sections.slice(0, step + 1).flatMap((section) => section.fields) as (keyof ProductOrderPrototypeInput)[];
    const valid = fields.length === 0 || await form.trigger(fields);
    const blocked = sections.slice(0, step + 1).some((section) =>
      (section.id === "source" && sourceExceeded) || (section.id === "ingredients" && ingredientExceeded));
    if (valid && !blocked) setStep(Math.min(step + 1, lastStep));
  }
  function resetExample() {
    form.reset(); setReviewed(false); setReviewOpen(false); setStep(0);
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
        if (!atReview) { event.preventDefault(); void continueStep(); return; }
        void form.handleSubmit(() => {
          if (!stockExceeded) {
            setReviewed(true);
            if (variant === "E") setReviewOpen(true);
          }
        }, () => setReviewed(false))(event);
      }} onChange={() => setReviewed(false)} className="min-w-0 space-y-20 border border-[var(--hair)] bg-[var(--paper)] p-16 sm:p-24 [&_input]:min-h-44 [&_select]:min-h-44 [&_button]:min-h-44 [&_input[type=radio]]:min-h-0 [&_input[type=checkbox]]:min-h-0">
        {isGuided && <p className="body-small text-[var(--color-text-secondary)]" role="status">{atReview ? "All steps are complete. Open any summary to edit." : `Step ${step + 1} of ${lastStep}`}</p>}
        <VariantSections key={variant} variant={variant} sections={sections} step={step} />
        {showSummary && <section aria-label="Inline review" className="space-y-12">
          <h2 className="body-large font-medium">{isProduct ? "Product" : "Order"} {variant === "E" || isGuided ? "review" : "overview"}</h2>
          {isProduct && <p className="body-small">{formatDate(values.placedAt)} / {isBlend ? "Chicken manure 50/50" : "Unblended biochar"} / Product bin {values.destination}</p>}
          {isProduct ? productSummary : orderSummary}
          {variant === "E" && <p className="body-caption text-[var(--color-text-secondary)]">This review updates as you edit the fields above.</p>}
        </section>}
        {reviewed && <p role="status" className="body-small">{isProduct ? "Product" : "Order"} preview reviewed. Nothing was saved.</p>}
        <div className="[&>div>div]:flex-wrap">
          <FormActions sticky={false} submitLabel={!atReview ? "Continue" : isProduct ? "Review product" : "Review order"} onCancel={resetExample} cancelLabel="Reset example" />
        </div>
      </form>
    </div>
  </div>;
}
