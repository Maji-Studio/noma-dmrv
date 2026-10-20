"use client";

/**
 * Throwaway: renders the settings prototype variant named by `?variant=`.
 * Mounted by `src/app/(app)/settings/page.tsx` only when the param is present.
 */
import type { ComponentType } from "react";
import { PrototypeSwitcher } from "./prototype-switcher";
import {
  useSettingsPrototypeVariant,
  type SettingsPrototypeVariant,
} from "./use-settings-prototype-variant";
import { VariantA, variantAName } from "./variant-a";
import { VariantB, variantBName } from "./variant-b";
import { VariantC, variantCName } from "./variant-c";
import { VariantD, variantDName } from "./variant-d";
import { VariantE, variantEName } from "./variant-e";

const VARIANTS: Record<SettingsPrototypeVariant, ComponentType> = {
  A: VariantA,
  B: VariantB,
  C: VariantC,
  D: VariantD,
  E: VariantE,
};

const NAMES: Record<SettingsPrototypeVariant, string> = {
  A: variantAName,
  B: variantBName,
  C: variantCName,
  D: variantDName,
  E: variantEName,
};

export function SettingsPrototype() {
  const variant = useSettingsPrototypeVariant();
  if (!variant) return null;
  const Variant = VARIANTS[variant];
  return (
    <>
      <Variant key={variant} />
      <PrototypeSwitcher current={variant} names={NAMES} />
    </>
  );
}
