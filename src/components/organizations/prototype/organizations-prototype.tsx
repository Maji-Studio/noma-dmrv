/** PROTOTYPE (#1373). Client switch between the variants that own their page. */
"use client";

import { PrototypeSwitcher } from "./prototype-switcher";
import { VariantA } from "./variant-a";
import { VariantB } from "./variant-b";
import { VariantC } from "./variant-c";

export function OrganizationsPrototype({ variant }: { variant: "A" | "B" | "C" }) {
  return (
    <>
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <PrototypeSwitcher current={variant} />
    </>
  );
}
