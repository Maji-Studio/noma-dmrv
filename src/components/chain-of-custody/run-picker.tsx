"use client";

import {
  CaretDownIcon,
  CheckIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

const BAND_CLASS =
  "flex h-40 items-center border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)]";
const CODE_CLASS =
  "min-w-0 truncate font-mono text-[11px] font-medium uppercase tracking-[0.1em]";
const TRIGGER_MAX_WIDTH_CLASS = "max-w-[260px]";
const MENU_WIDTH_PX = 280;
const MENU_MAX_HEIGHT_CLASS = "max-h-[320px]";
const CLEARABLE_TRIGGER_PADDING_CLASS = "pr-[56px]";
const CLEAR_BUTTON_RIGHT_CLASS = "right-[30px]";

export interface RunPickerOption {
  id: string;
  code: string;
  date: Date | string;
  applicationCount: number;
}

interface RunPickerProps {
  runs: RunPickerOption[];
  value: string | null;
  onChange: (runId: string | undefined) => void;
  disabled?: boolean;
}

function applicationCount(run: RunPickerOption): string {
  return `${run.applicationCount} ${
    run.applicationCount === 1 ? "application" : "applications"
  }`;
}

export function RunPicker({
  runs,
  value,
  onChange,
  disabled,
}: RunPickerProps) {
  const selected = runs.find((run) => run.id === value) ?? null;

  return (
    <div className="relative min-w-0 shrink-0">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={
            <button
              type="button"
              aria-label="Filter by production run"
              data-testid="chain-run-select-trigger"
              disabled={disabled}
              className={cn(
                BAND_CLASS,
                TRIGGER_MAX_WIDTH_CLASS,
                "group gap-10 px-12 text-left transition-colors",
                selected && !disabled && CLEARABLE_TRIGGER_PADDING_CLASS,
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:border-[var(--color-interaction)] " +
                      "focus-visible:outline-none focus-visible:border-[var(--color-interaction)]"
              )}
            />
          }
        >
          {selected ? (
            <>
              <span className={cn(CODE_CLASS, "text-[var(--color-text-primary)]")}>
                {selected.code}
              </span>
              <span className="min-w-0 truncate body-caption text-[var(--color-text-tertiary)]">
                {formatDate(selected.date)}
              </span>
            </>
          ) : (
            <span className={cn(CODE_CLASS, "text-[var(--clr-dark-purple-60)]")}>
              All production runs
            </span>
          )}
          <CaretDownIcon
            aria-hidden
            size={12}
            weight="bold"
            className="ml-auto shrink-0 text-[var(--clr-dark-purple-40)] transition-transform duration-150 group-data-[popup-open]:rotate-180"
          />
        </DropdownMenu.Trigger>

        <DropdownMenu.Content side="bottom" align="start" className="py-0">
          <div style={{ width: MENU_WIDTH_PX }}>
            <div className="border-b border-[var(--clr-dark-purple-10)] px-12 py-8 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--clr-dark-purple-40)]">
              Production run · narrows this batch
            </div>
            <div className={cn(MENU_MAX_HEIGHT_CLASS, "overflow-y-auto py-4")}>
              <DropdownMenu.Item
                onClick={() => onChange(undefined)}
                className="!px-12 !py-[9px]"
              >
                <span className="flex min-w-0 flex-1 items-center gap-8">
                  <span
                    className={cn(
                      CODE_CLASS,
                      value == null
                        ? "text-[var(--color-interaction)]"
                        : "text-[var(--color-text-secondary)]"
                    )}
                  >
                    All production runs
                  </span>
                  {value == null ? (
                    <CheckIcon
                      aria-hidden
                      size={13}
                      weight="bold"
                      className="ml-auto shrink-0 text-[var(--color-interaction)]"
                    />
                  ) : null}
                </span>
              </DropdownMenu.Item>
              {runs.map((run) => {
                const isSelected = run.id === value;
                return (
                  <DropdownMenu.Item
                    key={run.id}
                    onClick={() => onChange(run.id)}
                    className="!px-12 !py-[9px]"
                  >
                    <span
                      data-testid={`chain-run-option-${run.id}`}
                      className="flex min-w-0 flex-1 flex-col gap-2"
                    >
                      <span className="flex items-center gap-8">
                        <span
                          className={cn(
                            CODE_CLASS,
                            isSelected
                              ? "text-[var(--color-interaction)]"
                              : "text-[var(--color-text-primary)]"
                          )}
                        >
                          {run.code}
                        </span>
                        {isSelected ? (
                          <CheckIcon
                            aria-hidden
                            size={13}
                            weight="bold"
                            className="ml-auto shrink-0 text-[var(--color-interaction)]"
                          />
                        ) : null}
                      </span>
                      <span className="truncate body-caption text-[var(--color-text-secondary)]">
                        {formatDate(run.date)} · {applicationCount(run)}
                      </span>
                    </span>
                  </DropdownMenu.Item>
                );
              })}
            </div>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      {selected && !disabled ? (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          aria-label="Clear production run filter"
          data-testid="chain-run-select-clear"
          className={cn(
            CLEAR_BUTTON_RIGHT_CLASS,
            "absolute top-0 flex h-40 cursor-pointer items-center px-4 text-[var(--clr-dark-purple-40)] transition-colors hover:text-[var(--clr-dark-purple)]"
          )}
        >
          <XIcon size={13} weight="bold" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
