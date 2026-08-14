import type { RemovalTemplateDiagnosticModel } from "@/lib/certification/removal-template-diagnostic";
import { RemovalTemplateDiagnosticStatusBadge } from "./removal-template-diagnostic-status";

function EvidenceRoles({ roles }: { roles: string[] }) {
  return roles.length > 0 ? (
    <ul className="flex flex-col gap-2">
      {roles.map((role) => (
        <li key={role}>{role}</li>
      ))}
    </ul>
  ) : (
    <span className="text-[var(--color-text-tertiary)]">No bound Source role</span>
  );
}

export function RemovalTemplateMappingView({
  model,
}: {
  model: RemovalTemplateDiagnosticModel;
}) {
  return (
    <div className="flex flex-col gap-20">
      <div className="flex flex-col gap-4">
        <h3 className="title-heading-3">Input mapping matrix</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          Each row is one input in the active Isometric Removal template.
        </p>
      </div>

      {model.templateIssues.length > 0 && (
        <ul className="border-l-2 border-[var(--st-wait)] pl-12 body-small text-[var(--color-text-secondary)]">
          {model.templateIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      {model.groups.map((group) => (
        <section key={group.rawId} className="flex flex-col gap-10">
          <div className="flex flex-wrap items-baseline justify-between gap-8">
            <div>
              <p className="label-micro text-[var(--color-text-tertiary)]">
                Template group
              </p>
              <h4 className="body-large text-[var(--color-text-primary)]">
                {group.label}
              </h4>
            </div>
            <details className="body-caption text-[var(--color-text-tertiary)]">
              <summary className="cursor-pointer">Raw group identifiers</summary>
              <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 font-mono">
                <dt>Key</dt>
                <dd>{group.key}</dd>
                <dt>ID</dt>
                <dd>{group.rawId}</dd>
              </dl>
            </details>
          </div>

          {group.components.map((component) => (
            <div
              key={component.raw.componentId}
              className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-12 border-b border-[var(--color-border-tertiary)] bg-[var(--sea)] px-16 py-12">
                <div className="flex flex-col gap-4">
                  <h5 className="body-medium text-[var(--color-text-primary)]">
                    {component.label}
                  </h5>
                  <details className="body-caption text-[var(--color-text-tertiary)]">
                    <summary className="cursor-pointer">Raw component identifiers</summary>
                    <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 font-mono">
                      <dt>Blueprint</dt>
                      <dd>{component.blueprintKey}</dd>
                      <dt>Component ID</dt>
                      <dd>{component.raw.componentId}</dd>
                    </dl>
                  </details>
                </div>
                <div className="flex max-w-[420px] flex-col items-end gap-4 text-right">
                  <RemovalTemplateDiagnosticStatusBadge status={component.status} />
                  <p className="body-caption text-[var(--color-text-secondary)]">
                    {component.statusDetail}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1180px] table-fixed text-left">
                  <thead className="label-micro text-[var(--color-text-tertiary)]">
                    <tr className="border-b border-[var(--color-border-tertiary)]">
                      <th className="w-[180px] px-12 py-10">Template input</th>
                      <th className="w-[150px] px-12 py-10">Expected</th>
                      <th className="w-[180px] px-12 py-10">noma dMRV source</th>
                      <th className="w-[130px] px-12 py-10">Transform</th>
                      <th className="w-[220px] px-12 py-10">Submission wire path</th>
                      <th className="w-[150px] px-12 py-10">Evidence role</th>
                      <th className="w-[170px] px-12 py-10">Status</th>
                    </tr>
                  </thead>
                  <tbody className="body-caption">
                    {component.inputs.map((input) => (
                      <tr
                        key={input.inputKey}
                        className="align-top border-b border-[var(--color-border-tertiary)] last:border-b-0"
                      >
                        <td className="px-12 py-10">
                          <p className="body-small text-[var(--color-text-primary)]">
                            {input.label}
                          </p>
                          <code className="body-caption break-all text-[var(--color-text-tertiary)]">
                            {input.inputKey}
                          </code>
                          {!input.presentInTemplate && (
                            <p className="mt-4 text-[var(--st-wait)]">
                              Required locally, absent from template
                            </p>
                          )}
                        </td>
                        <td className="px-12 py-10">
                          <p>{input.expected.dataShape}</p>
                          <p>{input.expected.quantityKind}</p>
                          <p className="font-mono text-[var(--color-text-secondary)]">
                            {input.expected.unit}
                          </p>
                        </td>
                        <td className="px-12 py-10">{input.nomaSource}</td>
                        <td className="px-12 py-10">{input.transform}</td>
                        <td className="px-12 py-10 font-mono break-words text-[var(--color-text-secondary)]">
                          {input.wirePath}
                        </td>
                        <td className="px-12 py-10">
                          <EvidenceRoles roles={input.evidenceRoles} />
                        </td>
                        <td className="px-12 py-10">
                          <div className="flex flex-col items-start gap-6">
                            <RemovalTemplateDiagnosticStatusBadge status={input.status} />
                            <p className="text-[var(--color-text-secondary)]">
                              {input.statusDetail}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      ))}

      {model.optionalNotPresent.length > 0 && (
        <section className="flex flex-col gap-8 border border-dashed border-[var(--color-border-secondary)] px-16 py-12">
          <div className="flex flex-wrap items-center justify-between gap-8">
            <h4 className="body-medium">Optional targets not present</h4>
            <RemovalTemplateDiagnosticStatusBadge status="optional-not-present" />
          </div>
          <ul className="grid gap-6 body-caption sm:grid-cols-2">
            {model.optionalNotPresent.map((target) => (
              <li
                key={`${target.groupKey}:${target.blueprintKey}:${target.inputKey}:${target.evidenceRole}`}
              >
                <span className="text-[var(--color-text-primary)]">
                  {target.label}
                </span>{" "}
                <span className="text-[var(--color-text-tertiary)]">
                  ({target.evidenceRole})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
