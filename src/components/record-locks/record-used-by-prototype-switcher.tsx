/**
 * PROTOTYPE ONLY (Used by section round). `?variant=a|b|c` swaps the Used by
 * section (no param shows today's), `?scenario=real|many|none` swaps its
 * data. A floating pill at the bottom centre of the sheet steps through
 * both; ← and → step variants. Hidden in production builds. Delete with the
 * prototype once a variant is picked.
 */
"use client";

import { useEffect } from "react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { SCENARIOS, type Scenario } from "./record-used-by-prototype-fixtures";

export const VARIANTS = ["a", "b", "c"] as const;
export type Variant = (typeof VARIANTS)[number];
const STEPS: (Variant | null)[] = [null, ...VARIANTS];
const VARIANT_NAMES: Record<Variant, string> = { a: "Record rows", b: "Schematic", c: "Where it went" };
const SCENARIO_LABELS: Record<Scenario, string> = { real: "Real", many: "Many", none: "None" };
const QUERY_OPTIONS = { shallow: true, history: "replace", scroll: false } as const;
const SHOW_SWITCHER = process.env.NODE_ENV !== "production";

export function useUsedByPrototype() {
  const [variant, setVariant] = useQueryState("variant", parseAsStringLiteral(VARIANTS).withOptions(QUERY_OPTIONS));
  const [scenario, setScenario] = useQueryState("scenario", parseAsStringLiteral(SCENARIOS).withOptions(QUERY_OPTIONS));
  return { variant: SHOW_SWITCHER ? variant : null, setVariant, scenario: SHOW_SWITCHER ? scenario ?? "real" : "real", setScenario };
}

type Proto = ReturnType<typeof useUsedByPrototype>;

function variantLabel(variant: Variant | null): string {
  return variant ? `${variant.toUpperCase()} ${VARIANT_NAMES[variant]}` : "Current";
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const PILL_BUTTON = "grid h-44 w-44 place-items-center rounded-full hover:bg-[var(--acc-infra)]";

/** Fixed to the sheet (its popup is the containing block), above the footer. */
export function UsedByPrototypeSwitcher({ proto }: { proto: Proto }) {
  const index = STEPS.indexOf(proto.variant);
  const step = (delta: number) => void proto.setVariant(STEPS[(index + delta + STEPS.length) % STEPS.length]);

  // Keyboard stepping is a window subscription, the external-system sync useEffect exists for.
  useEffect(() => {
    if (!SHOW_SWITCHER) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || isTyping(event.target)) return;
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!SHOW_SWITCHER) return null;
  return (
    <div
      data-prototype-switcher
      className="fixed bottom-96 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full bg-[var(--ink)] p-4 text-[var(--paper)]"
    >
      <button type="button" aria-label="Previous variant" onClick={() => step(-1)} className={PILL_BUTTON}>
        <CaretLeftIcon size={16} weight="bold" aria-hidden />
      </button>
      <span className="min-w-[112px] text-center body-small font-medium whitespace-nowrap" aria-live="polite">{variantLabel(proto.variant)}</span>
      <button type="button" aria-label="Next variant" onClick={() => step(1)} className={PILL_BUTTON}>
        <CaretRightIcon size={16} weight="bold" aria-hidden />
      </button>
      <span aria-hidden className="mx-4 h-24 w-px bg-[var(--paper)] opacity-30" />
      <div role="group" aria-label="Data" className="flex items-center">
        {SCENARIOS.map((scenario) => (
          <button
            key={scenario}
            type="button"
            aria-pressed={proto.scenario === scenario}
            onClick={() => void proto.setScenario(scenario === "real" ? null : scenario)}
            className={cn(
              "h-44 rounded-full px-10 body-caption",
              proto.scenario === scenario ? "bg-[var(--paper)] text-[var(--ink)]" : "hover:bg-[var(--acc-infra)]",
            )}
          >
            {SCENARIO_LABELS[scenario]}
          </button>
        ))}
      </div>
    </div>
  );
}
