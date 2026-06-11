"use client";

import { type ElementType } from "react";
import Link from "next/link";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { STATUS_COLORS, STATUS_COLOR_FALLBACK } from "./chain-constants";

export interface ChainNodeData {
  label: string;
  code: string;
  icon: ElementType;
  accent: string;
  href: string | null;
  status?: string | null;
  detailLines: string[];
  /** Cross-link highlight (map marker / rail selection). */
  highlighted?: boolean;
  [key: string]: unknown;
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function StatusPill({ status }: { status: string | null | undefined }) {
  if (!status) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center px-8 py-2 border rounded-none body-caption uppercase tracking-[0.08em]"
      style={{
        color: STATUS_COLORS[status] ?? STATUS_COLOR_FALLBACK,
        borderColor: STATUS_COLORS[status] ?? STATUS_COLOR_FALLBACK,
      }}
    >
      {formatStatus(status)}
    </span>
  );
}

export function ChainNode({ data }: NodeProps) {
  const { label, code, icon: Icon, accent, href, status, detailLines, highlighted } =
    data as unknown as ChainNodeData;

  const card = (
    <div
      data-highlighted={highlighted ? "true" : undefined}
      className={`
        group flex border bg-[var(--color-background-white)] transition-colors
        ${href ? "cursor-pointer" : "cursor-default"}
        border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)] hover:bg-[var(--color-background-medium)]
      `}
      style={{
        width: 260,
        minHeight: 132,
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: accent,
        ...(highlighted
          ? {
              borderColor: accent,
              boxShadow: `0 0 0 4px color-mix(in srgb, ${accent} 28%, transparent)`,
            }
          : null),
      }}
    >
      <div className="flex-1 flex flex-col gap-10 p-12">
        <div className="flex items-start justify-between gap-10">
          <div className="min-w-0 flex items-center gap-8">
            <Icon
              size={18}
              weight="bold"
              style={{ color: accent }}
              className="shrink-0"
            />
            <span
              className="body-caption uppercase tracking-[0.1em] truncate"
              style={{ color: accent }}
            >
              {label}
            </span>
          </div>
          <StatusPill status={status} />
        </div>

        <p className="title-heading-3 break-words">{code}</p>

        {detailLines.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {detailLines.map((line, index) => (
              <li
                key={index}
                className="body-caption text-[var(--color-text-secondary)] break-words"
              >
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-[var(--clr-purple)] !w-[6px] !h-[6px] !border-0"
      />

      {href ? (
        <Link href={href} prefetch={false} onClick={(event) => event.stopPropagation()}>
          {card}
        </Link>
      ) : (
        card
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-[var(--clr-purple)] !w-[6px] !h-[6px] !border-0"
      />
    </>
  );
}
