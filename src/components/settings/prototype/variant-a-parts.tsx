"use client";

/**
 * Throwaway: small building blocks shared by the prototype variant A pane
 * files. Every save is a stub toast.
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { SegmentedControl } from "@/components/forms";
import { PROTOTYPE_SAVE_TOAST, type PrototypeFacility } from "./abd-fixtures";
import type { PrototypeActiveOrg } from "./abd-active-org";
import type { ARegistryState } from "./variant-a-registry-state";

export interface APaneProps {
  active: PrototypeActiveOrg;
  facility: PrototypeFacility;
  registry: ARegistryState;
  goTo: (pane: string) => void;
  openOrg: (orgId: string) => void;
}

export function useSaveStub() {
  const toast = useToast();
  return () => toast.info(PROTOTYPE_SAVE_TOAST);
}

export function ASection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-16 border-t border-[var(--color-border-secondary)] pt-20 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-16">
        <h2 className="body-small font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AReadRow({
  label,
  value,
  action,
}: {
  label: string;
  value: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-16">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="body-small text-[var(--color-text-secondary)]">{label}</span>
        <span className="body-medium break-words">{value}</span>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function ASaveRow({ label = "Save changes" }: { label?: string }) {
  const save = useSaveStub();
  return (
    <div className="flex">
      <Button variant="primary" onClick={save}>
        {label}
      </Button>
    </div>
  );
}

/** A quiet underlined text action, 44px tall on phones. */
export function ATextAction({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="body-small inline-flex min-h-44 items-center gap-6 text-left underline md:min-h-0"
    >
      {children}
    </button>
  );
}

export function ASegmented({
  id,
  legend,
  options,
  initial,
}: {
  id: string;
  legend: string;
  options: readonly string[];
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      id={id}
      legend={legend}
      options={options.map((o) => ({ value: o, label: o }))}
      value={value}
      onValueChange={setValue}
    />
  );
}
