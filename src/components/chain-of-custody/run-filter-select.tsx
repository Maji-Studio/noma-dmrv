"use client";

/**
 * Production-run filter for the batch roll-up. The options are derived from
 * the loaded batch's lineages (the runs below the credit batch) — never an
 * unscoped entity fetch — so the filter can only narrow within the batch.
 */

import { useEffect, useRef, useState } from "react";
import { CaretDownIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-utils";

export interface RunFilterOption {
  id: string;
  code: string;
  date: Date | string;
  applicationCount: number;
}

export interface RunFilterSelectProps {
  runs: RunFilterOption[];
  value: string | null;
  onChange: (runId: string | undefined) => void;
  disabled?: boolean;
}

export function RunFilterSelect({
  runs,
  value,
  onChange,
  disabled,
}: RunFilterSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = runs.find((run) => run.id === value) ?? null;

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const select = (runId: string | undefined) => {
    onChange(runId);
    setIsOpen(false);
  };

  const selectOnEnterOrSpace =
    (runId: string | undefined) => (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(runId);
      }
    };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label="Filter by production run"
          data-testid="chain-run-select-trigger"
          disabled={disabled}
          onClick={() => setIsOpen((open) => !open)}
          className={cn(
            "flex h-40 w-full items-center justify-between gap-8 border bg-[var(--color-background-white)] px-12 text-[var(--text-s)] transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]",
            "focus-visible:outline-none focus-visible:border-[var(--color-interaction)] focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)]",
            "border-[var(--color-border-secondary)]",
            disabled
              ? "cursor-not-allowed opacity-50"
              : "cursor-pointer hover:border-[var(--color-interaction)]",
            selected && !disabled ? "pr-[64px]" : "pr-[36px]"
          )}
        >
          <span
            className={cn(
              "truncate text-left",
              selected
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-tertiary)]"
            )}
          >
            {selected ? selected.code : "All production runs"}
          </span>
          <CaretDownIcon
            size={16}
            className={cn(
              "absolute right-12 shrink-0 text-[var(--color-text-tertiary)] transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </button>
        {selected && !disabled ? (
          <Button
            variant="noOutline"
            size="icon"
            onClick={() => select(undefined)}
            aria-label="Clear production run filter"
            data-testid="chain-run-select-clear"
            className="absolute right-[36px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            <XIcon size={16} />
          </Button>
        ) : null}
      </div>

      {isOpen ? (
        <ul
          role="listbox"
          aria-label="Production runs in this batch"
          data-testid="chain-run-select-listbox"
          className="absolute z-50 mt-1 max-h-[280px] w-full overflow-y-auto border border-[var(--color-border-primary)] bg-[var(--color-background-white)] shadow-lg"
        >
          <li
            role="option"
            aria-selected={value == null}
            tabIndex={0}
            onClick={() => select(undefined)}
            onKeyDown={selectOnEnterOrSpace(undefined)}
            className={cn(
              "cursor-pointer px-12 py-8 text-[var(--text-s)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-background-medium)]",
              "focus-visible:outline-none focus-visible:bg-[var(--color-background-medium)]",
              value == null && "bg-[var(--color-interaction-light)]"
            )}
          >
            All production runs
          </li>
          {runs.map((run) => (
            <li
              key={run.id}
              role="option"
              aria-selected={run.id === value}
              tabIndex={0}
              data-testid={`chain-run-option-${run.id}`}
              onClick={() => select(run.id)}
              onKeyDown={selectOnEnterOrSpace(run.id)}
              className={cn(
                "cursor-pointer px-12 py-8 transition-colors hover:bg-[var(--color-background-medium)]",
                "focus-visible:outline-none focus-visible:bg-[var(--color-background-medium)]",
                run.id === value && "bg-[var(--color-interaction-light)]"
              )}
            >
              <span className="block text-[var(--text-s)] text-[var(--color-text-primary)]">
                {run.code}
              </span>
              <span className="mt-2 block body-small text-[var(--color-text-secondary)]">
                {formatDate(run.date)} ·{" "}
                {run.applicationCount}{" "}
                {run.applicationCount === 1 ? "application" : "applications"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
