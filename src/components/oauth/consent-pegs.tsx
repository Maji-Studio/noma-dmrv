"use client";

import { CheckIcon, MinusIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import type { PegState } from "./consent-areas";

const PEG_ICON_SIZE = 14;
const SETTLED_ICON_SIZE = 16;

/** One peg: a 44px hit area around a 24px square that fills when on. A native checkbox carries the state. */
export function Peg({ state, label, onChange, disabled = false, invalid = false, describedBy }: {
  state: PegState;
  /** Accessible name that says the area and the access, e.g. "Feedstocks, write". */
  label: string;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  /** The board shows an error: red border while off, and the box points at the message. */
  invalid?: boolean;
  describedBy?: string;
}) {
  const on = state !== "off";
  return (
    <label className={cn("relative inline-flex size-44 items-center justify-center", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <input
        type="checkbox"
        aria-label={label}
        className="peer sr-only"
        checked={state === "on"}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        ref={(input) => { if (input) input.indeterminate = state === "mixed"; }}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          "flex size-24 items-center justify-center border transition-colors duration-200",
          on
            ? "border-[var(--color-interaction)] bg-[var(--color-interaction)] text-[var(--color-text-white-primary)]"
            : invalid
              ? "border-[var(--color-signal-red)] bg-[var(--color-background-white)]"
              : "border-[var(--color-border-secondary)] bg-[var(--color-background-white)] hover:border-[var(--color-border-primary)]",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-interaction)]",
          "peer-disabled:opacity-60 forced-colors:border-2",
        )}
      >
        {state === "on" && <CheckIcon size={PEG_ICON_SIZE} weight="bold" />}
        {state === "mixed" && <MinusIcon size={PEG_ICON_SIZE} weight="bold" />}
      </span>
    </label>
  );
}

/** A right the connection already has: no decision left, so no control, just a quiet tick. */
export function SettledPeg({ label }: { label: string }) {
  return (
    <span className="inline-flex size-44 items-center justify-center text-[var(--color-text-tertiary)]">
      <CheckIcon size={SETTLED_ICON_SIZE} weight="bold" aria-hidden />
      <span className="sr-only">{label}, already allowed</span>
    </span>
  );
}

/** Marks an area the app asked for just now. */
export function NewTag() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-4 border border-[var(--color-interaction)] px-4 body-caption text-[var(--color-text-interaction-primary)]">
      New
    </span>
  );
}
