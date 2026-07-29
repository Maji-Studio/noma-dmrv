import type { RemovalCompilationView } from "@/fn/certification";
import { Button } from "@/components/ui";
import { formatCount } from "@/lib/copy-utils";
import type { ReactNode } from "react";
import {
  CompilationBlockers,
  CompilationWarnings,
} from "./compilation-notices";

interface CompiledSubmissionReviewProps {
  compilation: RemovalCompilationView | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function ReviewSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-8 border-t border-[var(--color-border-tertiary)] pt-12">
      <h5 className="label-micro text-[var(--color-text-tertiary)]">
        {title}
      </h5>
      {children}
    </section>
  );
}

function EmptyValue({ children }: { children: ReactNode }) {
  return (
    <p className="body-small text-[var(--color-text-tertiary)]">{children}</p>
  );
}

function registryTargetLabel(target: string): string {
  switch (target) {
    case "/datapoints":
      return "Recorded values";
    case "/measurement-samples":
      return "Durability measurements";
    case "/ghg-entries":
      return "Removal record";
    default:
      return "Registry record";
  }
}

function bindingSourceLabel(
  binding: RemovalCompilationView["review"]["bindings"][number]["binding"],
): string {
  if (binding === "fixed") return "Template value";
  if (binding === "measurement-sample") return "Durability measurement";
  return "Recorded value";
}

const REGISTRY_FIELD_LABELS: Record<string, string> = {
  carbon_contents: "Carbon content",
  factor: "Emission factor",
  h_c_molar_ratios: "Hydrogen-to-carbon ratio",
  mass_distance: "Mass and distance",
  o_c_molar_ratios: "Oxygen-to-carbon ratio",
  product_mass: "Product mass",
  s_fraction: "Durability fraction",
};

function registryFieldLabel(
  inputKey: string,
  componentDisplayName?: string,
): string {
  const fieldLabel = REGISTRY_FIELD_LABELS[inputKey] ?? "Registry value";
  const componentLabel = componentDisplayName?.trim();
  if (
    !componentLabel ||
    componentLabel.includes("_") ||
    componentLabel.includes("/")
  ) {
    return fieldLabel;
  }
  return `${componentLabel}: ${fieldLabel}`;
}

export function CompiledSubmissionReview({
  compilation,
  isLoading,
  error,
  onRetry,
}: CompiledSubmissionReviewProps) {
  if (isLoading) {
    return (
      <div
        className="border border-[var(--color-border-secondary)] px-16 py-12"
        aria-live="polite"
      >
        <p className="body-small text-[var(--color-text-secondary)]">
          Preparing the registry submission…
        </p>
      </div>
    );
  }

  if (error || !compilation) {
    return (
      <div
        className="flex items-center justify-between gap-12 border border-[var(--st-error)] px-16 py-12"
        role="alert"
      >
        <p className="body-small text-[var(--color-text-primary)]">
          Submission details could not be prepared. Retry the review before
          submitting.
        </p>
        <Button variant="weak" onClick={onRetry}>
          Retry review
        </Button>
      </div>
    );
  }

  const { review, blockers, warnings, snapshot } = compilation;
  return (
    <div className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-16 py-16">
      <div className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex flex-col gap-2">
          <h4 className="title-heading-3">Registry submission details</h4>
          <p className="body-small text-[var(--color-text-secondary)]">
            Template {review.template.displayName}
          </p>
        </div>
        <Button variant="weak" onClick={onRetry}>
          Refresh review
        </Button>
      </div>

      <CompilationBlockers blockers={blockers} />

      <ReviewSection title="Registry plan">
        <p className="body-small text-[var(--color-text-secondary)]">
          {review.reportingWindow.startedOn || "Not recorded"} to{" "}
          {review.reportingWindow.completedOn || "Not recorded"}
        </p>
        <p className="body-small font-mono text-[var(--color-text-primary)]">
          {review.intendedPostTargets.map(registryTargetLabel).join(" · ") ||
            "No registry records prepared"}
        </p>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {snapshot
            ? "The submission values are ready. Supporting files and registry records are saved when you submit."
            : "The submission is not saved until you resolve all blockers."}
        </p>
      </ReviewSection>

      <ReviewSection title="Supporting sources">
        {(review.pendingSourceCount ?? 0) > 0 ? (
          <EmptyValue>
            {review.pendingSourceCount}{" "}
            {review.pendingSourceCount === 1 ? "file" : "files"} will be
            mirrored automatically when you submit.
          </EmptyValue>
        ) : review.sourceIds.length === 0 ? (
          <EmptyValue>No supporting files attached.</EmptyValue>
        ) : (
          <p className="body-small text-[var(--color-text-primary)]">
            {formatCount(review.sourceIds.length, "supporting file")} attached.
          </p>
        )}
      </ReviewSection>

      <ReviewSection title="Members and production">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Credit batches
            </p>
            <ul className="font-mono body-small">
              {review.memberCreditBatches.map((batch) => (
                <li key={batch.id}>
                  {batch.code}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Production runs
            </p>
            <ul className="font-mono body-small">
              {review.productionRuns.map((run) => (
                <li key={run.id}>
                  {run.code ?? "Code not recorded"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ReviewSection>

      <ReviewSection title="Registry input values">
        {review.bindings.length === 0 ? (
          <EmptyValue>No registry input values available.</EmptyValue>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left body-caption">
              <thead className="text-[var(--color-text-tertiary)]">
                <tr>
                  <th className="pr-12 pb-6">Registry field</th>
                  <th className="pr-12 pb-6">Source</th>
                  <th className="pb-6">Registry value or reference</th>
                </tr>
              </thead>
              <tbody>
                {review.bindings.map((binding) => (
                  <tr
                    key={`${binding.componentId}:${binding.inputKey}`}
                    className="border-t border-[var(--color-border-tertiary)]"
                  >
                    <td className="py-6 pr-12">
                      {registryFieldLabel(
                        binding.inputKey,
                        binding.componentDisplayName,
                      )}
                    </td>
                    <td className="py-6 pr-12">
                      {bindingSourceLabel(binding.binding)}
                    </td>
                    <td className="py-6 font-mono">
                      {binding.binding === "fixed"
                        ? "Set in template"
                        : binding.wireMagnitude === undefined
                          ? "Durability measurement"
                          : `${binding.wireMagnitude} ${binding.wireUnit ?? ""}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReviewSection>

      <ReviewSection title="Durability measurements">
        {review.measurementSamples.length === 0 ? (
          <EmptyValue>No durability measurements prepared.</EmptyValue>
        ) : (
          <ul className="space-y-8 body-small">
            {review.measurementSamples.map((sample) => (
              <li key={sample.operationKey}>
                <span className="font-medium">{sample.label}</span> ·{" "}
                <span className="font-mono">{sample.measuredAt ?? "Not recorded"}</span>
                <span className="ml-6 body-caption text-[var(--color-text-tertiary)]">
                  {formatCount(sample.values.length, "recorded value")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      <ReviewSection title="1000-year durability values">
        {review.directSequestrationDatapoints.length === 0 ? (
          <EmptyValue>No 1000-year durability values prepared.</EmptyValue>
        ) : (
          <ul className="space-y-2 font-mono body-small">
            {review.directSequestrationDatapoints.map((datapoint) => (
              <li key={`${datapoint.componentId}:${datapoint.inputKey}`}>
                {datapoint.magnitude} {datapoint.unit}
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      <ReviewSection title="Submission notes">
        <CompilationWarnings warnings={warnings} showEmpty />
      </ReviewSection>
    </div>
  );
}
