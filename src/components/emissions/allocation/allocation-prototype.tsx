/**
 * PROTOTYPE ONLY (allocation chart round). `?variant=a|b|c` swaps the Flow
 * view body, `?scenario=many|few|empty` swaps the fetched allocation for a
 * fixture, `?as=removal` shows the section from a Removal at side sheet width
 * (fixtures only). The switcher is a fixed pill outside the section. Delete
 * this file, the fixtures and the losing variants once a pick is folded in.
 */
"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { cn } from "@/lib/utils";
import { SCENARIOS } from "./allocation-prototype-fixtures";

export const VARIANTS = ["a", "b", "c"] as const;
export type Variant = (typeof VARIANTS)[number];
const AS_VALUES = ["removal"] as const;
const QUERY_OPTIONS = { shallow: true, history: "replace", scroll: false } as const;

export function useAllocationPrototype() {
  const [variant, setVariant] = useQueryState("variant", parseAsStringLiteral(VARIANTS).withOptions(QUERY_OPTIONS));
  const [scenario, setScenario] = useQueryState("scenario", parseAsStringLiteral(SCENARIOS).withOptions(QUERY_OPTIONS));
  const [as, setAs] = useQueryState("as", parseAsStringLiteral(AS_VALUES).withOptions(QUERY_OPTIONS));
  return { variant, setVariant, scenario, setScenario, asRemoval: as === "removal" && scenario !== null, setAs };
}

type Proto = ReturnType<typeof useAllocationPrototype>;

function Pill<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T | null; label: string }[]; value: T | null; onChange: (value: T | null) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="w-[56px] shrink-0 body-caption text-[var(--color-text-secondary)]">{label}</span>
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full px-10 py-6 body-caption",
            value === option.value ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--color-text-primary)] hover:bg-[var(--clr-dark-purple-5)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Fixed bottom-right, outside the section content. Changes only its own params. */
export function PrototypeSwitcher({ proto }: { proto: Proto }) {
  return (
    <div className="fixed right-16 bottom-16 z-50 flex flex-col gap-4 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-8">
      <Pill
        label="Variant"
        value={proto.variant}
        onChange={(next) => void proto.setVariant(next)}
        options={[{ value: null, label: "Current" }, { value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]}
      />
      <Pill
        label="Data"
        value={proto.scenario}
        onChange={(next) => {
          void proto.setScenario(next);
          if (next === null) void proto.setAs(null);
        }}
        options={[{ value: null, label: "Real" }, { value: "many", label: "Many" }, { value: "few", label: "Few" }, { value: "empty", label: "Empty" }]}
      />
      {proto.scenario !== null && (
        <Pill
          label="Page"
          value={proto.asRemoval ? "removal" : null}
          onChange={(next) => void proto.setAs(next)}
          options={[{ value: null, label: "Batch" }, { value: "removal" as const, label: "Removal" }]}
        />
      )}
    </div>
  );
}
