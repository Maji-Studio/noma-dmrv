import {
  ArrowDownIcon,
  CaretDownIcon,
} from "@phosphor-icons/react/dist/ssr";
import type {
  RemovalTemplateDiagnosticInput,
  RemovalTemplateDiagnosticModel,
} from "@/lib/certification/removal-template-diagnostic";
import {
  REMOVAL_TEMPLATE_STATUS_TONES,
  REMOVAL_TEMPLATE_TONE_COLORS,
  RemovalTemplateDiagnosticStatusBadge,
} from "./removal-template-diagnostic-status";

const IDENTITY_TRANSFORM = "Unchanged";

function RawIdentifiers({
  summary,
  entries,
}: {
  summary: string;
  entries: Array<[string, string]>;
}) {
  return (
    <details className="body-caption text-[var(--color-text-tertiary)]">
      <summary className="cursor-pointer">{summary}</summary>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 font-mono">
        {entries.flatMap(([term, value]) => [
          <dt key={`${term}-dt`}>{term}</dt>,
          <dd key={`${term}-dd`} className="break-all">
            {value}
          </dd>,
        ])}
      </dl>
    </details>
  );
}

function SourceNode({ input }: { input: RemovalTemplateDiagnosticInput }) {
  // Registry-owned inputs carry no noma data: the "source" is the template's
  // own fixed datapoint, drawn dashed so the eye reads "nothing flows in".
  const registryOwned = input.status === "registry-owned-fixed";
  return (
    <div
      className={`flex min-w-0 flex-col gap-4 border-[1.5px] bg-[var(--paper)] px-12 py-10 ${
        registryOwned
          ? "border-dashed border-[var(--clr-dark-purple-20)]"
          : "border-[var(--clr-dark-purple-20)]"
      }`}
    >
      <span className="font-mono text-[9px] font-medium uppercase tracking-[0.09em] text-[var(--clr-dark-purple-40)]">
        noma dMRV source
      </span>
      <span className="body-small break-words text-[var(--color-text-primary)]">
        {input.nomaSource}
      </span>
      {input.evidenceRoles.length > 0 && (
        <span className="body-caption break-words text-[var(--color-text-tertiary)]">
          {input.evidenceRoles.join(", ")}
        </span>
      )}
    </div>
  );
}

function Wire({
  input,
  tone,
}: {
  input: RemovalTemplateDiagnosticInput;
  tone: keyof typeof REMOVAL_TEMPLATE_TONE_COLORS;
}) {
  const color = REMOVAL_TEMPLATE_TONE_COLORS[tone];
  const broken = tone === "attention";
  const transform =
    input.transform === IDENTITY_TRANSFORM ? null : input.transform;
  return (
    <>
      {/* Horizontal wire on md+, vertical connector when the nodes stack. */}
      <div
        aria-hidden
        className="hidden min-w-0 flex-col items-stretch justify-center gap-4 md:flex"
      >
        {transform && (
          <span className="text-center font-mono text-[9px] font-medium uppercase tracking-[0.07em] break-words text-[var(--color-text-tertiary)]">
            {transform}
          </span>
        )}
        <span className="flex items-center">
          <span
            className="h-0 flex-1 border-t-[1.5px]"
            style={{
              borderColor: color,
              borderTopStyle: broken ? "dashed" : "solid",
            }}
          />
          <span
            className="size-0 border-y-[4px] border-l-[6px] border-y-transparent"
            style={{ borderLeftColor: color }}
          />
        </span>
      </div>
      <div aria-hidden className="flex items-center gap-8 pl-12 md:hidden">
        <ArrowDownIcon size={12} weight="bold" style={{ color }} />
        {transform && (
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.07em] text-[var(--color-text-tertiary)]">
            {transform}
          </span>
        )}
      </div>
    </>
  );
}

function DestinationNode({
  input,
  tone,
}: {
  input: RemovalTemplateDiagnosticInput;
  tone: keyof typeof REMOVAL_TEMPLATE_TONE_COLORS;
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-4 border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)] px-12 py-10"
      style={{
        borderLeftWidth: "3px",
        borderLeftColor: REMOVAL_TEMPLATE_TONE_COLORS[tone],
      }}
    >
      <span className="flex items-center justify-between gap-8">
        <span className="font-mono text-[9px] font-medium uppercase tracking-[0.09em] text-[var(--clr-dark-purple-40)]">
          Isometric input
        </span>
        <CaretDownIcon
          size={12}
          weight="bold"
          aria-hidden
          className="shrink-0 text-[var(--color-icon-tertiary)] transition-transform group-open:rotate-180"
        />
      </span>
      <span className="body-small break-words text-[var(--color-text-primary)]">
        {input.label}
      </span>
      <code className="body-caption text-[var(--color-text-tertiary)]">
        <span className="break-all">{input.inputKey}</span>{" "}
        <span className="whitespace-nowrap">· {input.expected.unit}</span>
      </code>
      {!input.presentInTemplate && (
        <span className="body-caption text-[var(--st-wait)]">
          Required locally, absent from template
        </span>
      )}
    </div>
  );
}

function WireRow({ input }: { input: RemovalTemplateDiagnosticInput }) {
  const tone = REMOVAL_TEMPLATE_STATUS_TONES[input.status];
  return (
    <details className="group">
      <summary className="grid cursor-pointer list-none gap-6 [&::-webkit-details-marker]:hidden md:grid-cols-[minmax(0,5fr)_minmax(90px,2fr)_minmax(0,5fr)] md:gap-0">
        <SourceNode input={input} />
        <Wire input={input} tone={tone} />
        <DestinationNode input={input} tone={tone} />
      </summary>
      <div className="mt-6 grid gap-x-16 gap-y-8 border-[1.5px] border-dashed border-[var(--clr-dark-purple-20)] px-12 py-10 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.09em] text-[var(--clr-dark-purple-40)]">
            Expected
          </span>
          <span className="body-caption text-[var(--color-text-secondary)]">
            {input.expected.dataShape} · {input.expected.quantityKind} ·{" "}
            {input.expected.unit}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.09em] text-[var(--clr-dark-purple-40)]">
            Evidence role
          </span>
          <span className="body-caption text-[var(--color-text-secondary)]">
            {input.evidenceRoles.join(", ") || "No bound Source role"}
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.09em] text-[var(--clr-dark-purple-40)]">
            Submission wire path
          </span>
          <span className="body-caption font-mono break-all text-[var(--color-text-secondary)]">
            {input.wirePath}
          </span>
        </div>
        <div className="flex flex-col gap-4 sm:col-span-2">
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.09em] text-[var(--clr-dark-purple-40)]">
            Status
          </span>
          <span className="flex flex-wrap items-center gap-8">
            <RemovalTemplateDiagnosticStatusBadge status={input.status} />
            <span className="body-caption text-[var(--color-text-secondary)]">
              {input.statusDetail}
            </span>
          </span>
        </div>
      </div>
    </details>
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
        <h3 className="title-heading-3">Input mapping</h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          Each row wires one noma dMRV source into one input of the active
          Isometric Removal template. Select a row for its wire detail.
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
            <RawIdentifiers
              summary="Raw group identifiers"
              entries={[
                ["Key", group.key],
                ["ID", group.rawId],
              ]}
            />
          </div>

          {group.components.length === 0 && (
            <p className="body-caption text-[var(--color-text-tertiary)]">
              No components in this group.
            </p>
          )}

          {group.components.map((component) => (
            <div
              key={component.raw.componentId}
              className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-12 gap-y-6 border-b border-[var(--color-border-tertiary)] bg-[var(--sea)] px-12 py-10">
                <div className="flex min-w-0 flex-col gap-4">
                  <h5 className="body-medium text-[var(--color-text-primary)]">
                    {component.label}
                  </h5>
                  <RawIdentifiers
                    summary="Raw component identifiers"
                    entries={[
                      ["Blueprint", component.blueprintKey],
                      ["Component ID", component.raw.componentId],
                    ]}
                  />
                </div>
                <div className="ml-auto flex min-w-0 flex-col items-end gap-4 text-right">
                  <RemovalTemplateDiagnosticStatusBadge
                    status={component.status}
                  />
                  <p className="body-caption max-w-[420px] text-[var(--color-text-secondary)]">
                    {component.statusDetail}
                  </p>
                </div>
              </div>

              <ol className="flex flex-col gap-10 p-12">
                {component.inputs.map((input) => (
                  <li key={input.inputKey}>
                    <WireRow input={input} />
                  </li>
                ))}
              </ol>
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
