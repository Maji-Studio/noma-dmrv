/**
 * CertifyPanel
 * Read-only Isometric Certify context inside the credit-batch side sheet.
 * Collapsed accordion: project + default removal template + the component
 * blueprints that template references. No submit action — Phase 3 wires that up.
 */
"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useCertifyContextForCreditBatch } from "@/hooks/use-certification";
import { BlueprintList } from "./blueprint-list";
import { Field, Section } from "./panel-layout";

interface CertifyPanelProps {
  creditBatchId: string;
}

export function CertifyPanel({ creditBatchId }: CertifyPanelProps) {
  const { data, isLoading, error } =
    useCertifyContextForCreditBatch(creditBatchId);

  return (
    <Section>
      <details className="group">
        <summary className="flex cursor-pointer items-center justify-between gap-12 list-none [&::-webkit-details-marker]:hidden">
          <div className="flex flex-col gap-4">
            <h3 className="title-chapter-title">Isometric Certify</h3>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              {data?.isProduction === true
                ? "Isometric · production"
                : "Isometric · sandbox"}
            </p>
          </div>
          <CaretDown
            size={18}
            weight="bold"
            className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 group-open:rotate-180"
          />
        </summary>

        <div className="mt-16">
          <PanelBody
            data={data}
            isLoading={isLoading}
            error={error ?? null}
          />
        </div>
      </details>
    </Section>
  );
}

function PanelBody({
  data,
  isLoading,
  error,
}: {
  data: ReturnType<typeof useCertifyContextForCreditBatch>["data"];
  isLoading: boolean;
  error: Error | null;
}) {
  if (isLoading) {
    return (
      <p className="body-small text-[var(--color-text-tertiary)]">
        Loading certification context…
      </p>
    );
  }

  if (error || !data) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load certification context";
    return (
      <p className="body-small text-[var(--color-signal-red)]">{message}</p>
    );
  }

  const {
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
  } = data;

  if (!mapping) {
    return (
      <p className="body-small text-[var(--color-text-secondary)]">
        This facility isn&apos;t linked to an Isometric project. Open the
        facility settings to set up registry submission.
      </p>
    );
  }

  const projectLabel = project?.name ?? mapping.externalProjectId;

  return (
    <div className="flex flex-col gap-20">
      <dl className="grid grid-cols-2 gap-x-16 gap-y-12">
        <Field label="Project">
          <span className="body-small">{projectLabel}</span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {mapping.externalProjectId}
          </span>
        </Field>
        <Field label="Default removal template">
          {defaultTemplate ? (
            <>
              <span className="body-small">
                {defaultTemplate.display_name}
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {defaultTemplate.id}
              </span>
            </>
          ) : missingDefaultTemplateId ? (
            <span className="body-small text-[var(--color-text-tertiary)]">
              {missingDefaultTemplateId}
            </span>
          ) : (
            <span className="body-small text-[var(--color-text-tertiary)]">
              Not set
            </span>
          )}
        </Field>
      </dl>

      {missingDefaultTemplateId && (
        <Warning>
          Default removal template{" "}
          <code className="font-mono">{missingDefaultTemplateId}</code> is no
          longer available in Certify for this project. Pick a new default in
          the facility&apos;s Isometric link.
        </Warning>
      )}

      {!defaultTemplate && !missingDefaultTemplateId && (
        <p className="body-small text-[var(--color-text-secondary)]">
          Default removal template not selected. Set one in the facility&apos;s
          Isometric link to enable submission previews.
        </p>
      )}

      {defaultTemplate && (
        <div className="flex flex-col gap-12">
          <h4 className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Component blueprints required by this template
          </h4>
          {unresolvedBlueprintKeys.length > 0 && (
            <Warning>
              {unresolvedBlueprintKeys.length} blueprint
              {unresolvedBlueprintKeys.length === 1 ? "" : "s"} referenced by
              this template{" "}
              {unresolvedBlueprintKeys.length === 1 ? "is" : "are"} no longer
              in Certify&apos;s catalog:{" "}
              <code className="font-mono">
                {unresolvedBlueprintKeys.join(", ")}
              </code>
            </Warning>
          )}
          <BlueprintList blueprints={blueprintsForTemplate} />
        </div>
      )}
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="body-small text-[var(--color-signal-orange)]">{children}</p>
  );
}
