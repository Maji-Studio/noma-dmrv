"use client";

import type { ReactNode } from "react";
import {
  CaretDownIcon,
  CertificateIcon,
  CheckIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { formatDateRange } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

const CONTROL_HEIGHT_CLASS = "h-40";
const BATCH_TRIGGER_MAX_WIDTH_CLASS = "max-w-[320px]";
const BATCH_MENU_WIDTH_PX = 320;
const BATCH_MENU_MAX_HEIGHT_CLASS = "max-h-[320px]";

const BORDERED_BAND_CLASS =
  "flex items-center border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)]";

const BATCH_CODE_CLASS =
  "min-w-0 truncate font-mono text-[11px] font-medium uppercase tracking-[0.1em]";

interface BatchPickerProps {
  batches: CreditBatchWithRelations[];
  selectedBatchId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onSelect: (batchId: string) => void;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

/** Quiet, non-interactive stand-in for the trigger while there is nothing to pick. */
function BatchPickerNotice({
  icon,
  children,
  role,
  tone = "quiet",
}: {
  icon: ReactNode;
  children: ReactNode;
  role?: "status" | "alert";
  tone?: "quiet" | "bad";
}) {
  return (
    <div
      role={role}
      className={cn(
        BORDERED_BAND_CLASS,
        CONTROL_HEIGHT_CLASS,
        BATCH_TRIGGER_MAX_WIDTH_CLASS,
        "gap-8 px-12 body-caption",
        tone === "bad"
          ? "border-[var(--st-bad-border)] text-[var(--st-bad)]"
          : "text-[var(--color-text-tertiary)]"
      )}
    >
      <span aria-hidden className="shrink-0">
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

export function BatchPicker({
  batches,
  selectedBatchId,
  isLoading,
  isError,
  error,
  onSelect,
}: BatchPickerProps) {
  const selected = batches.find((batch) => batch.id === selectedBatchId) ?? null;

  return (
    <div data-testid="chain-batch-selector" className="min-w-0 shrink-0">
      {isLoading ? (
        <BatchPickerNotice
          role="status"
          icon={<CertificateIcon size={16} className="animate-pulse" />}
        >
          Loading credit batches…
        </BatchPickerNotice>
      ) : isError ? (
        <BatchPickerNotice
          role="alert"
          tone="bad"
          icon={<WarningIcon size={16} weight="bold" />}
        >
          {error?.message ?? "Credit batches could not be loaded"}
        </BatchPickerNotice>
      ) : batches.length === 0 ? (
        <BatchPickerNotice icon={<CertificateIcon size={16} weight="bold" />}>
          No credit batches yet
        </BatchPickerNotice>
      ) : (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            render={
              <button
                type="button"
                // An aria-label REPLACES the trigger's text, so it has to carry
                // the selected value or the picker announces only its purpose.
                aria-label={
                  selected ? `Credit batch: ${selected.code}` : "Credit batch"
                }
                data-testid="chain-batch-selector-trigger"
                className={cn(
                  BORDERED_BAND_CLASS,
                  CONTROL_HEIGHT_CLASS,
                  BATCH_TRIGGER_MAX_WIDTH_CLASS,
                  "group cursor-pointer gap-10 px-12 text-left transition-colors",
                  "hover:border-[var(--color-interaction)]",
                  "focus-visible:outline-none focus-visible:border-[var(--color-interaction)]"
                )}
              />
            }
          >
            {selected ? (
              <>
                <span
                  className={cn(
                    BATCH_CODE_CLASS,
                    "text-[var(--color-text-primary)]"
                  )}
                >
                  {selected.code}
                </span>
                <span className="min-w-0 truncate body-caption text-[var(--color-text-tertiary)]">
                  {formatDateRange(selected.startDate, selected.endDate)}
                </span>
              </>
            ) : (
              <span className="min-w-0 truncate body-caption text-[var(--color-text-tertiary)]">
                Choose a credit batch
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
            <div style={{ width: BATCH_MENU_WIDTH_PX }}>
              <div className="border-b border-[var(--clr-dark-purple-10)] px-12 py-8 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--clr-dark-purple-40)]">
                Credit batch · remembered per facility
              </div>
              <div
                className={cn(
                  BATCH_MENU_MAX_HEIGHT_CLASS,
                  "overflow-y-auto py-4"
                )}
              >
                {batches.map((batch) => {
                  const isSelected = batch.id === selectedBatchId;
                  return (
                    <DropdownMenu.Item
                      key={batch.id}
                      onClick={() => onSelect(batch.id)}
                      className="!px-12 !py-[9px]"
                      // Single-select menu: the check glyph is the only visual
                      // cue, so the state has to be in the role too.
                      render={
                        <div role="menuitemradio" aria-checked={isSelected} />
                      }
                    >
                      <span
                        data-testid={`chain-batch-option-${batch.id}`}
                        className="flex min-w-0 flex-1 flex-col gap-2"
                      >
                        <span className="flex items-center gap-8">
                          <span
                            className={cn(
                              BATCH_CODE_CLASS,
                              isSelected
                                ? "text-[var(--color-interaction)]"
                                : "text-[var(--color-text-primary)]"
                            )}
                          >
                            {batch.code}
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
                          {formatDateRange(batch.startDate, batch.endDate)}
                        </span>
                        <span className="truncate body-caption text-[var(--color-text-tertiary)]">
                          {countLabel(batch.productionRunCount, "run")} ·{" "}
                          {countLabel(batch.applicationCount, "application")}
                        </span>
                      </span>
                    </DropdownMenu.Item>
                  );
                })}
              </div>
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      )}
    </div>
  );
}
