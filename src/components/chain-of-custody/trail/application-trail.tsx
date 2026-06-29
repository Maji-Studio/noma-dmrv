"use client";

/**
 * Application Trail (plan decision 4): the concept canvas's "pipeline"
 * (dated steps) and "attestation ledger" (evidence) merged into one vertical
 * reading — each custody step with its date and what attests it: linked
 * documents, production-run samples, mass figures, and transport-leg
 * `distanceSource` provenance.
 *
 * Step identity, dates, and masses come from the lineage payload the page
 * already holds; the evidence joins ride in via `useApplicationTrail`, keyed
 * by the shared DAG node-id convention.
 */

import {
  FileIcon,
  FlaskIcon,
  PathIcon,
  SealCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type {
  TrailNodeEvidence,
  TrailTransportLeg,
} from "@/data-access/chain-of-custody-trail";
import { useApplicationTrail } from "@/hooks/use-chain-of-custody";
import { formatSafeDate } from "@/lib/format-utils";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import {
  LINEAGE_NODE_STYLES,
  type LineageNodeKind,
} from "../chain-constants";

interface TrailStepDescriptor {
  nodeId: string;
  kind: LineageNodeKind;
  code: string;
  status: string | null;
  date: Date | string | null;
  massLine: string | null;
  contextLine: string | null;
}

function formatKg(value: number | null): string | null {
  if (value == null) return null;
  return `${Math.round(value).toLocaleString()} kg`;
}

function formatStepDate(value: Date | string | null): string {
  if (!value) return "No date";
  return formatSafeDate(value, "MMM d, yyyy");
}

/** Custody order, upstream to soil: feedstocks → run → lot → order → delivery → application. */
export function buildTrailSteps(chain: ChainOfCustodyData): TrailStepDescriptor[] {
  const steps: TrailStepDescriptor[] = [];

  const sortedFeedstocks = [...chain.feedstocks].sort((left, right) =>
    left.code.localeCompare(right.code)
  );
  for (const feedstock of sortedFeedstocks) {
    steps.push({
      nodeId: `feedstock:${feedstock.id}`,
      kind: "feedstock",
      code: feedstock.code,
      status: feedstock.status,
      date: feedstock.deliveryDate,
      massLine: formatKg(feedstock.massUsedKg ?? feedstock.massDryKg),
      contextLine: [feedstock.feedstockTypeName, feedstock.supplierName]
        .filter(Boolean)
        .join(" · ") || null,
    });
  }

  if (chain.productionRun) {
    steps.push({
      nodeId: `production-run:${chain.productionRun.id}`,
      kind: "productionRun",
      code: chain.productionRun.code,
      status: chain.productionRun.status,
      date: chain.productionRun.date,
      massLine: formatKg(chain.productionRun.biocharDryMassKg),
      contextLine: chain.reactor
        ? `Reactor ${chain.reactor.code}`
        : null,
    });
  }

  if (chain.biocharProduct) {
    steps.push({
      nodeId: `biochar-product:${chain.biocharProduct.id}`,
      kind: "biocharProduct",
      code: chain.biocharProduct.code,
      status: chain.biocharProduct.status,
      date: chain.biocharProduct.productionDate,
      massLine: formatKg(chain.biocharProduct.massKg),
      contextLine: null,
    });
  }

  if (chain.order) {
    steps.push({
      nodeId: `order:${chain.order.id}`,
      kind: "order",
      code: chain.order.code,
      status: null,
      date: chain.order.orderDate,
      massLine: formatKg(chain.order.quantityKg),
      contextLine: null,
    });
  }

  steps.push({
    nodeId: `delivery:${chain.delivery.id}`,
    kind: "delivery",
    code: chain.delivery.code,
    status: chain.delivery.status,
    date: chain.delivery.deliveryDate,
    massLine: formatKg(chain.delivery.massDryKg),
    contextLine: null,
  });

  steps.push({
    nodeId: `application:${chain.application.id}`,
    kind: "application",
    code: chain.application.code,
    status: chain.application.status,
    date: chain.application.applicationDate,
    massLine:
      chain.application.biocharAppliedDryTons != null
        ? `${chain.application.biocharAppliedDryTons.toFixed(2)} t dry applied`
        : null,
    contextLine: chain.application.fieldIdentifier,
  });

  return steps;
}

function TransportLegEvidence({ leg }: { leg: TrailTransportLeg }) {
  const sourceLabel = leg.distanceSource
    ? DISTANCE_SOURCE_LABELS[leg.distanceSource]
    : "Source not recorded";
  const endpoints = [leg.originName, leg.destinationName]
    .filter(Boolean)
    .join(" → ");
  return (
    <li className="flex items-start gap-8" data-testid="trail-evidence-leg">
      <PathIcon size={14} className="mt-2 shrink-0 text-[var(--color-text-tertiary)]" />
      <div className="min-w-0">
        <p className="body-small text-[var(--color-text-primary)]">
          Transport leg · {leg.distanceKm.toLocaleString()} km
          {leg.isDerived ? " · derived" : ""}
        </p>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {endpoints ? `${endpoints} · ` : ""}
          {sourceLabel}
        </p>
        {leg.documents.map((doc) => (
          <p
            key={doc.id}
            className="body-caption mt-2 text-[var(--color-text-secondary)]"
          >
            ↳ {doc.fileName}
          </p>
        ))}
      </div>
    </li>
  );
}

function StepEvidence({ evidence }: { evidence: TrailNodeEvidence | undefined }) {
  if (
    !evidence ||
    (evidence.documents.length === 0 &&
      evidence.samples.length === 0 &&
      evidence.transportLegs.length === 0)
  ) {
    return (
      <p className="body-caption text-[var(--color-text-tertiary)]">
        No attesting records
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-8">
      {evidence.documents.map((doc) => (
        <li
          key={doc.id}
          className="flex items-start gap-8"
          data-testid="trail-evidence-document"
        >
          <FileIcon
            size={14}
            className="mt-2 shrink-0 text-[var(--color-text-tertiary)]"
          />
          <div className="min-w-0">
            <p className="body-small break-words text-[var(--color-text-primary)]">
              {doc.fileName}
            </p>
            <p className="body-caption uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
              {doc.documentType.replaceAll("_", " ")}
            </p>
          </div>
        </li>
      ))}
      {evidence.samples.map((sample) => (
        <li
          key={sample.id}
          className="flex items-start gap-8"
          data-testid="trail-evidence-sample"
        >
          <FlaskIcon
            size={14}
            className="mt-2 shrink-0 text-[var(--color-text-tertiary)]"
          />
          <div className="min-w-0">
            <p className="body-small text-[var(--color-text-primary)]">
              Sample {sample.sampleCode ?? sample.id.slice(0, 8)}
            </p>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {formatSafeDate(sample.timestamp, "MMM d, yyyy HH:mm")}
            </p>
          </div>
        </li>
      ))}
      {evidence.transportLegs.map((leg) => (
        <TransportLegEvidence key={leg.id} leg={leg} />
      ))}
    </ul>
  );
}

export interface ApplicationTrailProps {
  applicationId: string;
  chainData: ChainOfCustodyData | undefined;
}

export function ApplicationTrail({ applicationId, chainData }: ApplicationTrailProps) {
  const { data: evidence, isLoading, isError, error } =
    useApplicationTrail(applicationId);

  if (!chainData || isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background-white)]">
        <p className="body-medium text-[var(--color-text-secondary)]">
          Loading trail...
        </p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background-white)]">
        <p className="body-medium text-[var(--color-signal-red)]">
          {error?.message || "Failed to load trail evidence."}
        </p>
      </div>
    );
  }

  const steps = buildTrailSteps(chainData);

  return (
    <div
      className="h-full overflow-auto bg-[var(--color-background-white)]"
      data-testid="application-trail"
    >
      <div className="mx-auto max-w-[760px] px-24 py-24">
        <div className="mb-16 flex items-center justify-between gap-16">
          <p className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            Custody trail · {steps.length} steps
          </p>
          <p className="flex items-center gap-6 body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]">
            <SealCheckIcon size={14} />
            {evidence?.totalCount ?? 0} attesting records
          </p>
        </div>

        <ol className="flex flex-col">
          {steps.map((step, index) => {
            const style = LINEAGE_NODE_STYLES[step.kind];
            const Icon = style.icon;
            const isLast = index === steps.length - 1;
            return (
              <li
                key={step.nodeId}
                className="relative flex gap-16 pb-24"
                data-testid="trail-step"
              >
                {!isLast ? (
                  <span
                    aria-hidden
                    className="absolute left-[15px] top-[32px] bottom-0 w-[1.5px] bg-[var(--color-border-secondary)]"
                  />
                ) : null}
                <span
                  className="z-10 flex size-32 shrink-0 items-center justify-center border-[1.5px] bg-[var(--color-background-white)]"
                  style={{ borderColor: style.accent, color: style.accentInk }}
                >
                  <Icon size={16} weight="bold" />
                </span>

                <div className="min-w-0 flex-1 border border-[var(--color-border-secondary)]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-16 gap-y-4 border-b border-[var(--color-border-secondary)] px-16 py-10">
                    <div className="flex items-baseline gap-10">
                      <span
                        className="font-mono text-[11px] font-medium uppercase tracking-[0.08em]"
                        style={{ color: style.accentInk }}
                      >
                        {style.label}
                      </span>
                      <span className="font-mono text-[13px] text-[var(--color-text-primary)]">
                        {step.code}
                      </span>
                      {step.status ? (
                        <span className="body-caption uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
                          {step.status.replaceAll("_", " ")}
                        </span>
                      ) : null}
                    </div>
                    <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
                      {formatStepDate(step.date)}
                    </span>
                  </div>

                  <div className="px-16 py-12">
                    {step.massLine || step.contextLine ? (
                      <p className="body-small mb-10 text-[var(--color-text-secondary)]">
                        {[step.massLine, step.contextLine]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}
                    <StepEvidence evidence={evidence?.byNodeId[step.nodeId]} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
