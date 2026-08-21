"use client";

import { useState } from "react";
import {
  MagnifyingGlassIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import {
  useRemovalCompilation,
  useRemovalsForFacility,
} from "@/hooks/use-certification";
import type { RemovalTemplateDiagnosticModel } from "@/lib/certification/removal-template-diagnostic";
import { attachRemovalCompilationToDiagnostic } from "@/lib/certification/removal-template-diagnostic-resolution";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDateRange } from "@/lib/format-utils";
import {
  CompilationBlockers,
  CompilationWarnings,
} from "./new-removal-dialog/compilation-notices";
import { RemovalTemplateDiagnosticStatusBadge } from "./removal-template-diagnostic-status";

const SHORT_ID_LENGTH = 8;

function removalLabel(entry: {
  removal: { id: string; startedOn: string | null; completedOn: string | null };
  memberBatches: Array<{ code: string }>;
}): string {
  const batches = entry.memberBatches.map((batch) => batch.code).join(", ");
  const window =
    entry.removal.startedOn && entry.removal.completedOn
      ? formatDateRange(entry.removal.startedOn, entry.removal.completedOn)
      : "Reporting window not compiled";
  return `${batches || `Removal ${entry.removal.id.slice(0, SHORT_ID_LENGTH)}`} (${window})`;
}

function formatMagnitude(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(value);
}

function ResolvedValue({
  input,
}: {
  input: RemovalTemplateDiagnosticModel["groups"][number]["components"][number]["inputs"][number];
}) {
  if (!input.resolved) {
    return (
      <span className="text-[var(--color-text-tertiary)]">
        No resolved compilation value
      </span>
    );
  }
  if (input.resolved.binding === "fixed") {
    return <span>1 fixed template reference</span>;
  }
  if (input.resolved.count === 0) {
    return <span className="text-[var(--color-text-tertiary)]">0 values</span>;
  }
  const { magnitudes, unit, count } = input.resolved;
  if (magnitudes.length === 1) {
    return (
      <span className="font-mono">
        {formatMagnitude(magnitudes[0])} {unit ?? ""}
      </span>
    );
  }
  const minimum = Math.min(...magnitudes);
  const maximum = Math.max(...magnitudes);
  return (
    <span>
      {count} values
      {magnitudes.length > 0 && (
        <span className="font-mono">
          {`: ${formatMagnitude(minimum)} to ${formatMagnitude(maximum)} ${unit ?? ""}`}
        </span>
      )}
    </span>
  );
}

export function RemovalTemplateTraceView({
  facilityId,
  model,
}: {
  facilityId: string;
  model: RemovalTemplateDiagnosticModel;
}) {
  const [removalId, setRemovalId] = useState("");
  const removals = useRemovalsForFacility(facilityId);
  const compilation = useRemovalCompilation(
    facilityId,
    removalId,
    Boolean(removalId),
  );
  const tracedModel = compilation.data
    ? attachRemovalCompilationToDiagnostic(model, compilation.data)
    : model;
  const removalEntries = removals.data?.removals ?? [];

  return (
    <div className="flex flex-col gap-20">
      <div className="flex flex-col gap-4">
        <h3 className="title-heading-3">Removal trace</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          Compile an existing Removal read-only and connect its resolved values
          to the same template mapping rows. This does not create or submit
          registry data.
        </p>
      </div>

      {removals.isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading Removals…
        </p>
      ) : removals.error ? (
        <EmptyState
          icon={<WarningIcon size={40} weight="bold" />}
          title="Removals could not be loaded"
          description="Refresh the page to retry the facility Removal list."
          padding="sm"
        />
      ) : removalEntries.length === 0 ? (
        <EmptyState
          icon={<MagnifyingGlassIcon size={40} weight="bold" />}
          title="No Removal to trace"
          description="This facility has no existing Removal. The template mapping remains available in the other views."
          padding="sm"
        />
      ) : (
        <label className="flex max-w-[640px] flex-col gap-6">
          <span className="label-input">Removal</span>
          <select
            className="h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
            value={removalId}
            onChange={(event) => setRemovalId(event.target.value)}
          >
            <option value="">Select a Removal</option>
            {removalEntries.map((entry) => (
              <option key={entry.removal.id} value={entry.removal.id}>
                {removalLabel(entry)}
              </option>
            ))}
          </select>
        </label>
      )}

      {removalId && compilation.isLoading && (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Compiling Removal read-only…
        </p>
      )}

      {removalId && compilation.error && (
        <EmptyState
          icon={<WarningIcon size={40} weight="bold" />}
          title="Compilation is unavailable"
          description={
            compilation.error instanceof Error
              ? compilation.error.message
              : "Check the project link, active template, and Removal source data."
          }
          padding="sm"
        />
      )}

      {compilation.data && (
        <>
          <section className="grid gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16 md:grid-cols-2">
            <div>
              <p className="label-micro text-[var(--color-text-tertiary)]">
                Mapping revision
              </p>
              <p className="body-caption break-all font-mono">
                {compilation.data.review.template.mappingRevision}
              </p>
            </div>
            <div>
              <p className="label-micro text-[var(--color-text-tertiary)]">
                Compilation hash
              </p>
              <p className="body-caption break-all font-mono">
                {compilation.data.compilationHash ?? MISSING_VALUE.notYetComputed}
              </p>
            </div>
          </section>

          <CompilationBlockers blockers={compilation.data.blockers} />
          <section className="flex flex-col gap-6">
            <h4 className="label-micro text-[var(--color-text-tertiary)]">
              Compilation warnings
            </h4>
            <CompilationWarnings warnings={compilation.data.warnings} showEmpty />
          </section>

          <section className="flex flex-col gap-10">
            <h4 className="body-large">Resolved template inputs</h4>
            <div className="overflow-x-auto border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
              <table className="w-full min-w-[780px] text-left">
                <thead className="label-micro bg-[var(--sea)] text-[var(--color-text-tertiary)]">
                  <tr>
                    <th className="px-12 py-10">Template destination</th>
                    <th className="px-12 py-10">noma dMRV source</th>
                    <th className="px-12 py-10">Resolved data</th>
                    <th className="px-12 py-10">Status</th>
                  </tr>
                </thead>
                <tbody className="body-caption">
                  {tracedModel.groups.flatMap((group) =>
                    group.components.flatMap((component) =>
                      component.inputs.map((input) => (
                        <tr
                          key={`${component.raw.componentId}:${input.inputKey}`}
                          className="align-top border-t border-[var(--color-border-tertiary)]"
                        >
                          <td className="px-12 py-10">
                            <p>{group.label}</p>
                            <p>{component.label}</p>
                            <code className="text-[var(--color-text-tertiary)]">
                              {input.inputKey}
                            </code>
                          </td>
                          <td className="px-12 py-10">{input.nomaSource}</td>
                          <td className="px-12 py-10">
                            <ResolvedValue input={input} />
                          </td>
                          <td className="px-12 py-10">
                            <RemovalTemplateDiagnosticStatusBadge status={input.status} />
                          </td>
                        </tr>
                      )),
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
