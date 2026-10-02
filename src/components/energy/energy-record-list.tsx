/**
 * EnergyRecordList: the ranked records of one kind (credit batches,
 * production runs, deliveries, applications) for the period. Each code links
 * to the record's own side sheet; a separate caret control expands the row
 * into its per-source breakdown, so both work from the keyboard.
 */
"use client";

import { Fragment, useState, type MouseEvent } from "react";
import Link from "next/link";
import {
  CaretDownIcon,
  CaretRightIcon,
  ListBulletsIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { applicationDeepLinkHref } from "@/lib/application-links";
import { productionRunDeepLinkHref } from "@/lib/certification/links";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { deliveryDeepLinkHref } from "@/lib/delivery-links";
import {
  rankRecords,
  recordHasMissingReadings,
  recordRankValue,
} from "@/lib/energy/selection";
import type {
  EnergyCreditBatchInput,
  EnergyRecord,
  EnergyRecordScope,
} from "@/lib/energy/types";
import { formatDateRange, formatDayString } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  formatCreditBatchStatus,
  type CreditBatchStatus,
} from "@/schemas/credit-batches";
import { formatActivity, formatEstimate } from "./energy-display";
import { EnergyRecordBreakdown, EnergySourceBar } from "./energy-record-breakdown";

const TOP_ROWS = 20;
const PERCENT = 100;
/** A record ranked far below the top still shows a visible sliver of bar. */
const MIN_BAR_PERCENT = 8;
/** Phones drop the bar column, so the table only needs its width from `sm`. */
const TABLE_MIN_WIDTH_CLASS = "sm:min-w-[560px]";
const BAR_COLUMN_WIDTH_CLASS = "hidden w-[35%] sm:table-cell";
const TABPANEL_ID = "energy-records-panel";

export const ENERGY_RECORD_SCOPES: { key: EnergyRecordScope; label: string }[] = [
  { key: "batch", label: "Credit batches" },
  { key: "run", label: "Production runs" },
  { key: "delivery", label: "Deliveries" },
  { key: "application", label: "Applications" },
];

function recordHref(record: EnergyRecord, facilityId: string): string {
  switch (record.scope) {
    case "batch":
      return creditBatchDeepLinkHref(record.id, facilityId);
    case "run":
      return productionRunDeepLinkHref(record.id, facilityId);
    case "delivery":
      return deliveryDeepLinkHref(record.id, facilityId);
    case "application":
      return applicationDeepLinkHref(record.id, facilityId);
  }
}

function recordContext(
  record: EnergyRecord,
  batches: Map<string, EnergyCreditBatchInput>,
): string | null {
  if (record.scope !== "batch") return record.context;
  const status = batches.get(record.id)?.status;
  return status ? formatCreditBatchStatus(status as CreditBatchStatus) : null;
}

interface EnergyRecordListProps {
  records: EnergyRecord[];
  creditBatches: EnergyCreditBatchInput[];
  facilityId: string;
  hasFactors: boolean;
  scope: EnergyRecordScope;
  onScopeChange: (scope: EnergyRecordScope) => void;
}

export function EnergyRecordList({
  records,
  creditBatches,
  facilityId,
  hasFactors,
  scope,
  onScopeChange,
}: EnergyRecordListProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const batches = new Map(creditBatches.map((batch) => [batch.id, batch]));
  const ranked = rankRecords(records.filter((record) => record.scope === scope));
  const shown = showAll ? ranked : ranked.slice(0, TOP_ROWS);
  const maxValue = ranked[0] ? recordRankValue(ranked[0]) : 0;

  const changeScope = (next: EnergyRecordScope) => {
    onScopeChange(next);
    setOpenId(null);
    setShowAll(false);
  };
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  return (
    <section aria-label="Records" className="flex flex-col gap-12">
      <div
        role="tablist"
        aria-label="Records to list"
        className="flex gap-24 overflow-x-auto border-b border-[var(--color-border-tertiary)]"
      >
        {ENERGY_RECORD_SCOPES.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={scope === item.key}
            aria-controls={TABPANEL_ID}
            onClick={() => changeScope(item.key)}
            className={cn(
              "-mb-px min-h-44 shrink-0 whitespace-nowrap border-b-2 body-small font-medium",
              scope === item.key
                ? "border-[var(--color-interaction)] text-[var(--color-text-primary)]"
                : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id={TABPANEL_ID} role="tabpanel" className="flex flex-col gap-12">
        {ranked.length === 0 ? (
          <EmptyState
            icon={<ListBulletsIcon size={32} />}
            title="Nothing recorded in this period"
            description="Choose a longer period or another credit batch."
            padding="sm"
          />
        ) : (
          <div className="overflow-x-auto bg-[var(--panel-bg)] [border:var(--panel-border)]">
            <table className={cn("w-full text-left", TABLE_MIN_WIDTH_CLASS)}>
              <thead className="bg-[var(--sea)]">
                <tr className="body-small text-[var(--color-text-secondary)]">
                  <th scope="col" className="px-16 py-10 font-medium">Record</th>
                  <th scope="col" className="px-12 py-10 font-medium">Date</th>
                  <th scope="col" className="px-12 py-10 text-right font-medium">
                    {hasFactors ? "Est. CO₂e" : "Diesel"}
                  </th>
                  <th scope="col" className={cn("px-16 py-10 font-medium", BAR_COLUMN_WIDTH_CLASS)}>
                    {hasFactors ? "By source" : "Diesel by use"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((record) => {
                  const open = openId === record.id;
                  const value = recordRankValue(record);
                  const context = recordContext(record, batches);
                  const breakdownId = `energy-breakdown-${record.id}`;
                  return (
                    <Fragment key={record.id}>
                      <tr
                        className={cn(
                          "cursor-pointer [border-top:var(--row-divider)] hover:bg-[var(--color-background-light)]",
                          open && "bg-[var(--color-background-light)]",
                        )}
                        onClick={() => toggle(record.id)}
                      >
                        <td className="px-16 py-10">
                          <div className="flex items-center gap-4">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-controls={open ? breakdownId : undefined}
                              aria-label={`${open ? "Hide" : "Show"} the breakdown of ${record.code}`}
                              onClick={(event: MouseEvent) => {
                                event.stopPropagation();
                                toggle(record.id);
                              }}
                              className="-my-10 -ml-16 flex size-44 shrink-0 items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            >
                              {open ? (
                                <CaretDownIcon size={12} weight="bold" aria-hidden="true" />
                              ) : (
                                <CaretRightIcon size={12} weight="bold" aria-hidden="true" />
                              )}
                            </button>
                            <Link
                              href={recordHref(record, facilityId)}
                              onClick={(event) => event.stopPropagation()}
                              className="whitespace-nowrap body-small font-medium text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline"
                            >
                              {record.code}
                            </Link>
                            {recordHasMissingReadings(record) && (
                              <WarningIcon
                                size={14}
                                weight="bold"
                                className="shrink-0 text-[var(--st-wait)]"
                                aria-label="Has missing readings"
                                role="img"
                              />
                            )}
                          </div>
                          {context && (
                            <span className="block pl-32 body-caption text-[var(--color-text-tertiary)]">
                              {context}
                            </span>
                          )}
                        </td>
                        <td className="px-12 py-10 body-small text-[var(--color-text-secondary)] sm:whitespace-nowrap">
                          {record.endDay
                            ? formatDateRange(record.day, record.endDay)
                            : formatDayString(record.day)}
                        </td>
                        <td className="whitespace-nowrap px-12 py-10 text-right body-small tabular-nums">
                          {hasFactors ? formatEstimate(value) : formatActivity(value, "L")}
                        </td>
                        <td className={cn("px-16 py-10", BAR_COLUMN_WIDTH_CLASS)}>
                          <div
                            style={{
                              width: `${maxValue > 0 ? Math.max((value / maxValue) * PERCENT, MIN_BAR_PERCENT) : 0}%`,
                            }}
                          >
                            <EnergySourceBar record={record} />
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr id={breakdownId} className="bg-[var(--color-background-light)]">
                          <td colSpan={4}>
                            <EnergyRecordBreakdown record={record} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ranked.length > TOP_ROWS && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="self-start body-small font-medium text-[var(--color-interaction)] underline-offset-4 hover:underline"
          >
            {showAll ? `Show the top ${TOP_ROWS}` : `Show all ${ranked.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
