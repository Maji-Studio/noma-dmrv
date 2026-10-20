/** PROTOTYPE (#1276), not for merge. The floating variant and scenario switcher. */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useProtoParams } from "./shared";

const VARIANTS = [
  { key: "a", label: "A Dialog" },
  { key: "b", label: "B Page" },
  { key: "c", label: "C Checklist" },
] as const;
const SCENARIOS = [
  { key: "protocol", label: "Protocol default" },
  { key: "ready", label: "Zero decisions" },
] as const;

/** Floating switcher, outside the content. Hidden with `shot=1`. */
export function ProtoSwitcher() {
  const params = useSearchParams();
  const { variant, scenario, shot } = useProtoParams();
  if (!variant || shot) return null;
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.set("section", "removal-templates");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return `/certification/settings?${next.toString()}`;
  };
  const chip = (active: boolean) =>
    cn(
      "body-caption border px-8 py-4",
      active
        ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
        : "border-[var(--color-border-secondary)] bg-[var(--paper)] text-[var(--color-text-primary)]",
    );
  return (
    <div className="fixed bottom-16 right-16 z-[60] flex flex-col gap-6 border border-[var(--ink)] bg-[var(--paper)] p-10">
      <span className="body-caption text-[var(--color-text-tertiary)]">Prototype #1276</span>
      <div className="flex flex-wrap gap-4">
        {VARIANTS.map((item) => (
          <Link key={item.key} href={href({ variant: item.key, state: null, a: null, template: null })} className={chip(variant === item.key)}>
            {item.label}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {SCENARIOS.map((item) => (
          <Link key={item.key} href={href({ scenario: item.key, state: null, a: null, template: null })} className={chip(scenario.key === item.key)}>
            {item.label}
          </Link>
        ))}
        <Link href={href({ state: null, a: null, template: null })} className={chip(false)}>Reset</Link>
      </div>
    </div>
  );
}
