/**
 * PROTOTYPE (branch prototype/emission-allocation, never merge). Question: how
 * should noma show what share of each emissions source record a credit batch
 * carries (Emissions tab) and a Removal carries (Removal sheet), so nothing is
 * counted twice? Four variants on fixture data mirroring staging TZ001.
 * Params: ?variant=A..D&surface=batch|removal&focus=<CB or RM code>&removals=one|two
 */
"use client";

import { focusFor, type RemovalFixture, type Surface } from "./fixture";
import { AllocationSwitcher, VARIANTS, type VariantKey } from "./prototype-switcher";
import { BatchSurface, RemovalSurface } from "./surfaces";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";
import { VariantD } from "./variant-d";

export interface AllocationPrototypeParams {
  variant?: string;
  surface?: string;
  focus?: string;
  removals?: string;
}

const SHEET_CLOSED = "none";

export function AllocationPrototype(params: AllocationPrototypeParams) {
  const variant = (VARIANTS.find((v) => v.key === params.variant)?.key ?? "A") as VariantKey;
  const surface: Surface = params.surface === "removal" ? "removal" : "batch";
  const fixture: RemovalFixture = params.removals === "two" ? "two" : "one";
  const open = params.focus !== SHEET_CLOSED;
  const focus = focusFor(surface, params.focus ?? "", fixture);
  const body =
    variant === "A" ? <VariantA focus={focus} /> :
    variant === "B" ? <VariantB focus={focus} /> :
    variant === "C" ? <VariantC focus={focus} /> :
    <VariantD focus={focus} fixture={fixture} />;
  return (
    <>
      {surface === "batch" ? (
        <BatchSurface focus={focus}>{body}</BatchSurface>
      ) : (
        <RemovalSurface focus={focus} fixture={fixture} open={open}>{body}</RemovalSurface>
      )}
      <AllocationSwitcher variant={variant} surface={surface} focusKey={focus.owner.key} fixture={fixture} />
    </>
  );
}
