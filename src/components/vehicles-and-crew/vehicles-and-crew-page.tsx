/**
 * Vehicles and crew: the organization's vehicles, drivers and operators, as a
 * list page under Distribution (Q13). Every member can list, create, edit and
 * delete them, as they can from the pickers on intake, delivery and
 * production forms. Not facility-scoped, so it works with no facility chosen.
 *
 * PROTOTYPE: three layouts on the real route, switched by `?variant=a|b|c`
 * (A tabs, B stacked tables, C one list). Fold the pick in and delete the
 * switcher and the other variant files.
 */
"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { PrototypeVariantSwitcher, type PrototypeVariant } from "./prototype-variant-switcher";
import { VehiclesAndCrewTabs } from "./variant-a-tabs";
import { VehiclesAndCrewStacked } from "./variant-b-stacked";
import { VehiclesAndCrewCombined } from "./variant-c-combined";

const VARIANT_KEYS = ["a", "b", "c"] as const;
type VariantKey = (typeof VARIANT_KEYS)[number];

const VARIANTS: ReadonlyArray<PrototypeVariant<VariantKey>> = [
  { key: "a", name: "Tabs" },
  { key: "b", name: "Stacked tables" },
  { key: "c", name: "One list" },
];

export function VehiclesAndCrewPage() {
  const [variant, setVariant] = useQueryState(
    "variant",
    parseAsStringLiteral(VARIANT_KEYS).withDefault("a").withOptions({ history: "replace" }),
  );

  return (
    <>
      {variant === "a" && <VehiclesAndCrewTabs />}
      {variant === "b" && <VehiclesAndCrewStacked />}
      {variant === "c" && <VehiclesAndCrewCombined />}
      <PrototypeVariantSwitcher variants={VARIANTS} current={variant} onChange={(next) => void setVariant(next)} />
    </>
  );
}
