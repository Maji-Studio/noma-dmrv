import type { RemovalCompilationView } from "@/fn/certification";
import { Button } from "@/components/ui";
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
          Compiling the registry submission…
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
          Submission compilation unavailable. Nothing can be submitted until
          the review compiles successfully.
        </p>
        <Button variant="weak" onClick={onRetry}>
          Retry compilation
        </Button>
      </div>
    );
  }

  const { review, blockers, warnings, snapshot } = compilation;
  return (
    <div className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-16 py-16">
      <div className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex flex-col gap-2">
          <h4 className="title-heading-3">Compiled Isometric submission</h4>
          <p className="body-small text-[var(--color-text-secondary)]">
            Template {review.template.displayName} ·{" "}
            <span className="font-mono">{review.template.id}</span> · mapping{" "}
            <span className="font-mono">{review.template.mappingRevision}</span>
          </p>
        </div>
        <Button variant="weak" onClick={onRetry}>
          Recompile
        </Button>
      </div>

      <CompilationBlockers blockers={blockers} />

      <ReviewSection title="Outbound plan">
        <p className="body-small text-[var(--color-text-secondary)]">
          {review.reportingWindow.startedOn || "—"} →{" "}
          {review.reportingWindow.completedOn || "—"}
        </p>
        <p className="body-small font-mono text-[var(--color-text-primary)]">
          {review.intendedPostTargets.join(" · ") || "No POST targets compiled"}
        </p>
        {compilation.compilationHash && (
          <p className="body-caption font-mono break-all text-[var(--color-text-tertiary)]">
            Artifact hash · {compilation.compilationHash}
          </p>
        )}
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {snapshot
            ? "Stable semantic and wire values are ready. Versioned supplier references and the immutable POST snapshot are materialized once when the ledger claim assigns its version."
            : "No immutable POST snapshot will be claimed while compilation blockers remain."}
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
          <EmptyValue>No supporting Source IDs.</EmptyValue>
        ) : (
          <ul className="space-y-2 font-mono body-small text-[var(--color-text-primary)]">
            {review.sourceIds.map((sourceId) => (
              <li key={sourceId}>{sourceId}</li>
            ))}
          </ul>
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
                  {batch.code} · {batch.id}
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
                  {run.code ?? "Uncoded"} · {run.id}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ReviewSection>

      <ReviewSection title="Resolved component/input bindings">
        {review.bindings.length === 0 ? (
          <EmptyValue>No bindings resolved.</EmptyValue>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left body-caption">
              <thead className="text-[var(--color-text-tertiary)]">
                <tr>
                  <th className="pr-12 pb-6">Component / input</th>
                  <th className="pr-12 pb-6">Binding</th>
                  <th className="pb-6">Wire value or identity</th>
                </tr>
              </thead>
              <tbody>
                {review.bindings.map((binding) => (
                  <tr
                    key={`${binding.componentId}:${binding.inputKey}`}
                    className="border-t border-[var(--color-border-tertiary)]"
                  >
                    <td className="py-6 pr-12 font-mono">
                      {binding.componentBlueprintKey}
                      <br />
                      {binding.componentId} / {binding.inputKey}
                    </td>
                    <td className="py-6 pr-12">{binding.binding}</td>
                    <td className="py-6 font-mono">
                      {binding.fixedDatapointId ??
                        (binding.wireMagnitude === undefined
                          ? "measurement sample"
                          : `${binding.wireMagnitude} ${binding.wireUnit ?? ""} · ${binding.wireType ?? ""}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReviewSection>

      <ReviewSection title="Measurement samples">
        {review.measurementSamples.length === 0 ? (
          <EmptyValue>No measurement-sample POSTs compiled.</EmptyValue>
        ) : (
          <ul className="space-y-8 body-small">
            {review.measurementSamples.map((sample) => (
              <li key={sample.operationKey}>
                <span className="font-medium">{sample.label}</span> ·{" "}
                <span className="font-mono">{sample.measuredAt ?? "—"}</span>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono body-caption">
                  {JSON.stringify(sample.values)}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      <ReviewSection title="Direct sequestration datapoints (s_fraction)">
        {review.directSequestrationDatapoints.length === 0 ? (
          <EmptyValue>No direct sequestration datapoints compiled.</EmptyValue>
        ) : (
          <ul className="space-y-2 font-mono body-small">
            {review.directSequestrationDatapoints.map((datapoint) => (
              <li key={`${datapoint.componentId}:${datapoint.inputKey}`}>
                {datapoint.componentId} / {datapoint.inputKey}:{" "}
                {datapoint.magnitude} {datapoint.unit} · {datapoint.type}
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      <ReviewSection title="Captured but not represented">
        <CompilationWarnings warnings={warnings} showEmpty />
      </ReviewSection>
    </div>
  );
}
