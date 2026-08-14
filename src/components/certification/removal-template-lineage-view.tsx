import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { RemovalTemplateDiagnosticModel } from "@/lib/certification/removal-template-diagnostic";
import { RemovalTemplateDiagnosticStatusBadge } from "./removal-template-diagnostic-status";

function Stage({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border border-[var(--color-border-tertiary)] bg-[var(--color-background-white)] px-12 py-10">
      <p className="label-micro mb-6 text-[var(--color-text-tertiary)]">
        {label}
      </p>
      <div className="body-small break-words text-[var(--color-text-primary)]">
        {children}
      </div>
    </div>
  );
}

export function RemovalTemplateLineageView({
  model,
}: {
  model: RemovalTemplateDiagnosticModel;
}) {
  return (
    <div className="flex flex-col gap-20">
      <div className="flex flex-col gap-4">
        <h3 className="title-heading-3">Input lineage</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          Read each row from noma dMRV through wire preparation to the active
          Isometric template input.
        </p>
      </div>

      {model.groups.map((group) => (
        <section key={group.rawId} className="flex flex-col gap-10">
          <div>
            <p className="label-micro text-[var(--color-text-tertiary)]">
              {group.key}
            </p>
            <h4 className="body-large">{group.label}</h4>
          </div>

          {group.components.map((component) => (
            <div
              key={component.raw.componentId}
              className="border border-[var(--color-border-secondary)] bg-[var(--sea)] p-12"
            >
              <div className="mb-10 flex flex-wrap items-center justify-between gap-8">
                <div>
                  <h5 className="body-medium">{component.label}</h5>
                  <code className="body-caption text-[var(--color-text-tertiary)]">
                    {component.blueprintKey}
                  </code>
                </div>
                <RemovalTemplateDiagnosticStatusBadge status={component.status} />
              </div>

              <ol className="flex flex-col gap-8">
                {component.inputs.map((input) => (
                  <li
                    key={input.inputKey}
                    className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)]"
                  >
                    <Stage label="noma dMRV source">
                      <p>{input.nomaSource}</p>
                      <p className="mt-4 body-caption text-[var(--color-text-tertiary)]">
                        {input.evidenceRoles.join(", ") || "No bound Source role"}
                      </p>
                    </Stage>
                    <span className="hidden items-center justify-center text-[var(--color-text-tertiary)] lg:flex">
                      <ArrowRightIcon size={16} weight="bold" aria-hidden />
                    </span>
                    <Stage label="Transform and wire preparation">
                      <p>{input.transform}</p>
                      <p className="mt-4 body-caption font-mono text-[var(--color-text-tertiary)]">
                        {input.wirePath}
                      </p>
                    </Stage>
                    <span className="hidden items-center justify-center text-[var(--color-text-tertiary)] lg:flex">
                      <ArrowRightIcon size={16} weight="bold" aria-hidden />
                    </span>
                    <Stage label="Isometric destination">
                      <p>{group.label}</p>
                      <p>{component.label}</p>
                      <code className="body-caption text-[var(--color-text-tertiary)]">
                        {input.inputKey}
                      </code>
                      <div className="mt-6">
                        <RemovalTemplateDiagnosticStatusBadge status={input.status} />
                      </div>
                    </Stage>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
