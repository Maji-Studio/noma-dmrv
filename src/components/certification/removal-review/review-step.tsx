/**
 * ReviewStep — step 2 of the removal Review flow. The read-only composition of
 * what's being submitted: the registry project + resolved template, the member
 * credit batches, and the transport-leg coverage the template requires. The
 * reporting window itself is derived server-side from production dates at
 * submit time, so it's described rather than shown here.
 */
"use client";

import { CheckCircle, Warning, XCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui";
import type {
  RemovalCertifyContext,
  TransportCategory,
} from "@/fn/certification/certify-context";
import { formatMass } from "@/lib/format-utils";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <div className="body-small text-[var(--color-text-primary)]">{children}</div>
    </div>
  );
}

type CoverageStatus = "complete" | "incomplete" | "missing";

function coverageStatus(ctx: RemovalCertifyContext, cat: TransportCategory): CoverageStatus {
  const bucket = ctx.transportCoverage[cat];
  if (bucket.count === 0) return "missing";
  return bucket.aggregationWarning !== null ? "incomplete" : "complete";
}

const COVERAGE_ICON = {
  complete: (
    <CheckCircle
      size={16}
      weight="fill"
      aria-hidden
      className="text-[var(--color-signal-green)]"
    />
  ),
  incomplete: (
    <Warning
      size={16}
      weight="fill"
      aria-hidden
      className="text-[var(--color-signal-orange)]"
    />
  ),
  missing: (
    <XCircle
      size={16}
      weight="fill"
      aria-hidden
      className="text-[var(--clr-red)]"
    />
  ),
} as const;

const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  complete: "Complete",
  incomplete: "Incomplete — mixed methods/factors",
  missing: "No transport legs found",
};

const CATEGORY_META: Record<
  TransportCategory,
  {
    label: string;
    recordLabel: string;
    route: string;
    queryKey: string;
  }
> = {
  feedstock: {
    label: "Feedstock",
    recordLabel: "feedstock record",
    route: "/feedstocks",
    queryKey: "feedstock",
  },
  biochar: {
    label: "Biochar",
    recordLabel: "biochar product",
    route: "/biochar-products",
    queryKey: "biocharProduct",
  },
  sample: {
    label: "Sample",
    recordLabel: "lab sample",
    route: "/samples",
    queryKey: "sample",
  },
};

function pluralize(label: string, count: number) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function buildTransportLegActionHref(
  ctx: RemovalCertifyContext,
  cat: TransportCategory,
) {
  const meta = CATEGORY_META[cat];
  const entityId = ctx.transportCoverage[cat].entityIds[0];
  if (!entityId) return null;

  const params = new URLSearchParams({
    facility: ctx.facilityId,
    [meta.queryKey]: entityId,
    transportLeg: "create",
  });

  return `${meta.route}?${params.toString()}`;
}

function coverageHint(ctx: RemovalCertifyContext, cat: TransportCategory) {
  const bucket = ctx.transportCoverage[cat];
  const meta = CATEGORY_META[cat];
  const records = pluralize(meta.recordLabel, bucket.entityIds.length);

  if (bucket.count === 0) {
    return bucket.entityIds.length > 0
      ? `Add at least one transport leg on the linked ${records}.`
      : `No linked ${meta.recordLabel}s were resolved for this removal.`;
  }

  if (bucket.aggregationWarning) {
    return "Open the linked records and align the leg calculation method and factors.";
  }

  return `${pluralize("transport leg", bucket.count)} recorded across ${records}.`;
}

export function ReviewStep({ ctx }: { ctx: RemovalCertifyContext }) {
  const projectLabel = ctx.project?.name ?? ctx.mapping?.externalProjectId ?? "—";
  const required = ctx.requiredTransportCategories;

  return (
    <div className="flex flex-col gap-24">
      <div className="flex flex-col gap-8">
        <h2 className="title-heading-3">Review</h2>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          What will be sent to the registry. The reporting window is derived
          from the underlying production dates when you submit.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-24 sm:grid-cols-2">
        <Field label="Registry project">
          {projectLabel}
          {ctx.mapping && (
            <span className="block body-caption font-mono text-[var(--color-text-tertiary)]">
              {ctx.mapping.externalProjectId}
            </span>
          )}
        </Field>
        <Field label="Removal template">
          {ctx.defaultTemplate ? (
            <>
              {ctx.defaultTemplate.display_name}
              <span className="block body-caption font-mono text-[var(--color-text-tertiary)]">
                {ctx.defaultTemplate.id}
              </span>
            </>
          ) : (
            <span className="text-[var(--color-signal-orange)]">
              Not resolved — see Pre-flight
            </span>
          )}
        </Field>
      </div>

      <Field label={`Credit batches (${ctx.memberBatches.length})`}>
        <span className="font-mono">
          {ctx.memberBatches.map((b) => b.code).join(", ") || "—"}
        </span>
      </Field>

      {ctx.runSummary.runCount > 0 && (
        <section className="flex flex-col gap-8">
          <div className="grid grid-cols-1 gap-24 sm:grid-cols-3">
            <Field label="Production runs">{ctx.runSummary.runCount}</Field>
            <Field label="Biochar output">
              {formatMass(ctx.runSummary.totalBiocharOutputKg)}
            </Field>
            <Field label="Applied (this removal)">
              {formatMass(ctx.runSummary.appliedDryKg)}
            </Field>
          </div>
          <p className="body-caption text-[var(--color-text-tertiary)] max-w-[680px]">
            A removal counts only the biochar that reached soil — applied mass
            is scoped per run against its output, so it submits a share of the
            total output above.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-8">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Transport coverage
        </span>
        {required.length === 0 ? (
          <p className="body-small text-[var(--color-text-secondary)]">
            This template requires no transport legs.
          </p>
        ) : (
          <ul className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
            {required.map((cat, index) => {
              const status = coverageStatus(ctx, cat);
              const actionHref =
                status === "complete" ? null : buildTransportLegActionHref(ctx, cat);
              return (
                <li
                  key={cat}
                  className={`flex flex-col gap-10 px-16 py-12 sm:flex-row sm:items-center sm:justify-between ${
                    index > 0
                      ? "border-t border-[var(--color-border-tertiary)]"
                      : ""
                  }`}
                >
                  <div className="flex flex-col gap-3">
                    <span className="body-small text-[var(--color-text-primary)]">
                      {CATEGORY_META[cat].label}
                    </span>
                    <span className="body-caption text-[var(--color-text-tertiary)]">
                      {coverageHint(ctx, cat)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-10">
                    <span className="inline-flex items-center gap-6 body-caption text-[var(--color-text-secondary)]">
                      {COVERAGE_ICON[status]}
                      {COVERAGE_LABEL[status]}
                    </span>
                    {actionHref && (
                      <Link
                        href={actionHref}
                        className={buttonVariants({
                          variant: status === "missing" ? "primary" : "default",
                          size: "small",
                        })}
                      >
                        {status === "missing" ? "Add leg" : "Fix legs"}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
