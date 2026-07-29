"use client";

/**
 * Chain node detail side-sheet — a read-only slide-over opened by clicking a
 * card on the DAG / lineage graph. Replaces the old click-to-navigate so a
 * click stays in context (the full record is one explicit step away via "View
 * full record"). Application cards in the batch roll-up also offer "Trace
 * rollback" to drill into that member's lineage.
 */

import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import { ArrowUpRightIcon, TreeStructureIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { DetailField, DetailRow, DetailSection } from "@/components/ui/detail-panel";
import { getStatusState, getStatusStateColor } from "@/lib/status-state";
import type { LineageDetailRow } from "./use-chain-graph";

export interface ChainNodeSheetNode {
  id: string;
  /** Entity type label ("Feedstock", "Order", …). */
  label: string;
  code: string;
  icon: Icon;
  /** Ink-variant accent — passes contrast on the light sheet. */
  accentInk: string;
  status?: string | null;
  date: string | null;
  details: LineageDetailRow[];
  /** Full-record route, when the node maps to a routed entity page. */
  href: string | null;
  /** Batch roll-up application card — offers "Trace rollback". */
  drillable?: boolean;
}

interface ChainNodeSheetProps {
  node: ChainNodeSheetNode | null;
  onOpenChange: (open: boolean) => void;
  /** Navigate to the full entity record (sheet's only outbound link). */
  onViewRecord?: () => void;
  /** Drill the batch roll-up into this application's rollback. */
  onTrace?: () => void;
}

function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <span
      className="inline-flex items-center gap-6 whitespace-nowrap border-[1.5px] border-current px-6 py-2 font-mono text-[9px] font-medium uppercase tracking-[0.09em]"
      data-status-state={getStatusState(status)}
      style={{ color: getStatusStateColor(status) }}
    >
      <span aria-hidden className="size-[6px] bg-current" />
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ChainNodeSheet({
  node,
  onOpenChange,
  onViewRecord,
  onTrace,
}: ChainNodeSheetProps) {
  // Keep the last node mounted while the panel animates out (a closing node is
  // null, but the content must stay until the slide-out finishes).
  const [display, setDisplay] = useState<ChainNodeSheetNode | null>(node);
  if (node && node !== display) setDisplay(node);

  const open = node !== null;
  if (!display) return null;

  const { label, code, icon: Icon, accentInk, status, date, details, href, drillable } =
    display;

  return (
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size="narrow">
        <SlideOverPanel.Header>
          <div className="flex items-center justify-between gap-12">
            <span
              className="inline-flex min-w-0 items-center gap-6 font-mono text-[10px] font-medium uppercase tracking-[0.09em]"
              style={{ color: accentInk }}
            >
              <Icon size={13} weight="bold" className="shrink-0" />
              <span className="truncate">{label}</span>
            </span>
            <StatusPill status={status} />
          </div>
          <SlideOverPanel.Title>{code}</SlideOverPanel.Title>
          {date ? <SlideOverPanel.Description>{date}</SlideOverPanel.Description> : null}
        </SlideOverPanel.Header>

        <SlideOverPanel.Body className="flex flex-col gap-20">
          {details.length > 0 ? (
            <DetailSection title="Details" divider={false}>
              {details.map((row) => (
                <DetailRow key={`${row.label}:${row.value}`}>
                  <DetailField label={row.label} value={row.value} />
                </DetailRow>
              ))}
            </DetailSection>
          ) : (
            <p className="body-small text-[var(--color-text-tertiary)]">
              No additional detail recorded for this record.
            </p>
          )}
        </SlideOverPanel.Body>

        {(drillable && onTrace) || (href && onViewRecord) ? (
          <SlideOverPanel.Footer className="justify-stretch">
            {drillable && onTrace ? (
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  onOpenChange(false);
                  onTrace();
                }}
              >
                <TreeStructureIcon size={14} weight="bold" />
                Trace rollback
              </Button>
            ) : null}
            {href && onViewRecord ? (
              <Button
                variant="default"
                className="flex-1"
                onClick={() => {
                  onOpenChange(false);
                  onViewRecord();
                }}
              >
                <ArrowUpRightIcon size={14} weight="bold" />
                View full record
              </Button>
            ) : null}
          </SlideOverPanel.Footer>
        ) : null}
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}
