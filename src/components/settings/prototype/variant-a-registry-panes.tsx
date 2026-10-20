"use client";

/**
 * Throwaway: the registry panes of prototype variant A.
 *
 * - Organization, Registry: a fixed head that reads the same for any registry
 *   (which registry, connection status), then one block titled after the
 *   registry with everything only Isometric has.
 * - Organization, Removal templates: the default template and its component
 *   decisions (Isometric only).
 * - Facility, Isometric: the `fcl_` link, the durability tier and the soil
 *   reference temperature.
 * - Platform, Template mapping: read only.
 *
 * The prototype "Registry state" toggle (`?registry=`) drives every pane.
 */
import { useState } from "react";
import {
  CheckCircleIcon,
  CircleDashedIcon,
  CertificateIcon,
  WarningCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, Notice } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  ChoiceCardGroup,
  FormField,
  FormInput,
  FormSelect,
} from "@/components/forms";
import { fixtures } from "./abd-fixtures";
import {
  AReadRow,
  ASaveRow,
  ASection,
  ATextAction,
  useSaveStub,
  type APaneProps,
} from "./variant-a-parts";

const REGISTRY_NAME = fixtures.registry.name;

const VISIBILITY_OPTIONS = [
  {
    value: "private",
    title: "Private to verifiers",
    description: "Only the verifier of a Removal can open its sources on Isometric.",
  },
  {
    value: "public",
    title: "Public on the registry",
    description: "Anyone who views the Removal on Isometric can open its sources.",
  },
] as const;

const TIER_OPTIONS = [
  {
    value: "1000-year",
    title: "1000-year",
    description: "Measured from random reflectance and non-reactive carbon.",
  },
  {
    value: "200-year",
    title: "200-year",
    description: "Modelled from the H/C org ratio and the soil temperature.",
  },
] as const;

/* Organization, Registry ------------------------------------------------------------------------ */

function AStatusLine({ registry }: Pick<APaneProps, "registry">) {
  const reg = fixtures.registry;
  if (registry === "connected") {
    return (
      <p className="body-small flex items-start gap-8">
        <CheckCircleIcon size={16} weight="fill" className="mt-2 shrink-0 text-[var(--st-ok)]" aria-hidden />
        <span>
          <span className="font-medium">Connected.</span> Last checked {reg.lastCheck}.
        </span>
      </p>
    );
  }
  if (registry === "keys-missing") {
    return (
      <p className="body-small flex items-start gap-8">
        <WarningIcon size={16} weight="fill" className="mt-2 shrink-0 text-[var(--st-wait)]" aria-hidden />
        <span>
          <span className="font-medium">Keys not saved.</span> Save the {REGISTRY_NAME} keys below to connect.
        </span>
      </p>
    );
  }
  return (
    <p className="body-small flex items-start gap-8">
      <WarningCircleIcon size={16} weight="fill" className="mt-2 shrink-0 text-[var(--st-bad)]" aria-hidden />
      <span>
        <span className="font-medium">Connection failing since {reg.lastCheck}.</span> {REGISTRY_NAME} refused
        the saved keys. Replace them below, then check again.
      </span>
    </p>
  );
}

function ARegistryHead({ active, registry }: Pick<APaneProps, "active" | "registry">) {
  const toast = useToast();
  const save = useSaveStub();

  if (registry === "none") {
    return (
      <div className="flex flex-col gap-12">
        <p className="body-medium">
          Registry: <span className="text-[var(--color-text-secondary)]">Not set</span>
        </p>
        <p className="body-small text-[var(--color-text-secondary)]">
          Connect {REGISTRY_NAME} to submit Removals, set up Removal templates and link each facility.
        </p>
        {active.canManage && (
          <div className="flex">
            <Button variant="primary" onClick={save}>
              Connect {REGISTRY_NAME}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-4">
        <p className="body-medium">
          Registry: <span className="font-medium">{REGISTRY_NAME}</span>
        </p>
        {active.canManage && (
          <ATextAction onClick={() => toast.info(`Prototype: ${REGISTRY_NAME} is the only registry today`)}>
            Change registry
          </ATextAction>
        )}
      </div>
      <AStatusLine registry={registry} />
      {registry === "failing" && (
        <div className="flex pl-24">
          <ATextAction onClick={() => toast.info("Prototype: nothing checked")}>Check again</ATextAction>
        </div>
      )}
    </div>
  );
}

function AKeysForm({ onCancel }: { onCancel?: () => void }) {
  const save = useSaveStub();
  return (
    <div className="flex flex-col gap-16">
      <FormField id="a-iso-token" label="Access token">
        <FormInput id="a-iso-token" type="password" autoComplete="off" />
      </FormField>
      <FormField id="a-iso-secret" label="Client secret" helperText="Saved keys are never shown again.">
        <FormInput id="a-iso-secret" type="password" autoComplete="off" />
      </FormField>
      <div className="flex flex-wrap gap-8">
        <Button variant="primary" onClick={save}>
          Save keys
        </Button>
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

function AKeys({ active, registry }: Pick<APaneProps, "active" | "registry">) {
  const [replacing, setReplacing] = useState(false);
  const reg = fixtures.registry;

  if (registry === "keys-missing" && active.canManage) return <AKeysForm />;
  if (replacing) return <AKeysForm onCancel={() => setReplacing(false)} />;

  const failing = registry === "failing";
  const value =
    registry === "keys-missing" ? (
      "Not set"
    ) : (
      <span className="inline-flex items-center gap-6">
        {failing ? (
          <WarningCircleIcon size={16} weight="fill" className="text-[var(--st-bad)]" aria-hidden />
        ) : (
          <CheckCircleIcon size={16} weight="fill" className="text-[var(--st-ok)]" aria-hidden />
        )}
        {failing ? "Saved, refused by Isometric" : `Saved, access token ${reg.keyHint}`}
      </span>
    );
  return (
    <AReadRow
      label="Keys"
      value={value}
      action={
        active.canManage && registry !== "keys-missing" ? (
          <Button variant={failing ? "primary" : "default"} onClick={() => setReplacing(true)}>
            Replace
          </Button>
        ) : undefined
      }
    />
  );
}

function AIsometricBlock({ active, registry, goTo }: Pick<APaneProps, "active" | "registry" | "goTo">) {
  const reg = fixtures.registry;
  const keysSaved = registry !== "keys-missing";
  const [visibility, setVisibility] = useState("private");

  return (
    <ASection title={REGISTRY_NAME}>
      <AKeys active={active} registry={registry} />

      {keysSaved ? (
        <>
          <FormField id="a-project" label="Project">
            <FormInput id="a-project" defaultValue={reg.project} />
          </FormField>
          <AReadRow label="Protocol" value={reg.protocol} />
        </>
      ) : (
        <AReadRow label="Project" value="Not set. Save the keys first." />
      )}

      <FormField id="a-visibility" label="Source visibility">
        <ChoiceCardGroup
          id="a-visibility"
          legend="Source visibility"
          options={VISIBILITY_OPTIONS}
          value={visibility}
          onValueChange={setVisibility}
        />
      </FormField>

      {keysSaved ? (
        <AReadRow
          label="Default Removal template"
          value={
            <span className="flex flex-col gap-2">
              {reg.defaultRemovalTemplate}
              <span className="body-small inline-flex items-center gap-6 text-[var(--st-wait)]">
                <WarningIcon size={14} weight="fill" aria-hidden />
                {reg.componentsToDecide} components to decide
              </span>
            </span>
          }
          action={<ATextAction onClick={() => goTo("removal-templates")}>Decide components</ATextAction>}
        />
      ) : (
        <AReadRow label="Default Removal template" value="Not set. Templates load once the keys are saved." />
      )}

      {active.canManage && <ASaveRow />}
    </ASection>
  );
}

export function ARegistryPane({ active, registry, goTo }: APaneProps) {
  return (
    <div className="flex flex-col gap-24 content-measure-form">
      <ARegistryHead active={active} registry={registry} />
      {registry !== "none" && <AIsometricBlock active={active} registry={registry} goTo={goTo} />}
    </div>
  );
}

/* Organization, Removal templates --------------------------------------------------------------- */

export function ARemovalTemplatesPane({ active, registry, goTo }: APaneProps) {
  const save = useSaveStub();
  const reg = fixtures.registry;

  if (registry === "keys-missing") {
    return (
      <EmptyState
        padding="md"
        icon={<CertificateIcon size={40} />}
        title="Removal templates load from Isometric"
        description="Save the Isometric keys, then choose the default Removal template here."
        action={<Button onClick={() => goTo("registry")}>Open Registry</Button>}
      />
    );
  }

  const toDecide = reg.components.filter((c) => !c.decided).length;
  return (
    <div className="flex flex-col gap-24 content-measure-form">
      {registry === "failing" && (
        <Notice
          tone="warning"
          action={<ATextAction onClick={() => goTo("registry")}>Open Registry</ATextAction>}
        >
          Isometric is not answering. These templates are from {reg.lastGoodCheck}.
        </Notice>
      )}
      <ASection title="Default Removal template">
        <FormField id="a-template" label="Template" helperText="New credit batches start on it.">
          <FormSelect
            id="a-template"
            options={reg.removalTemplates.map((t) => ({ value: t, label: t }))}
            defaultValue={reg.defaultRemovalTemplate}
          />
        </FormField>
        {active.canManage && <ASaveRow />}
      </ASection>

      <ASection
        title={`Components of ${reg.defaultRemovalTemplate}`}
        action={
          toDecide > 0 && active.canManage ? (
            <Button variant="primary" size="small" onClick={save}>
              Decide components
            </Button>
          ) : undefined
        }
      >
        {toDecide > 0 && (
          <span className="body-small inline-flex items-center gap-6 text-[var(--st-wait)]">
            <WarningIcon size={14} weight="fill" aria-hidden />
            {toDecide} components to decide
          </span>
        )}
        <ul className="flex flex-col border-t border-[var(--clr-dark-purple-10)]">
          {reg.components.map((component) => (
            <li
              key={component.name}
              className="flex items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-10"
            >
              <span className="body-medium min-w-0">{component.name}</span>
              {component.decided ? (
                <span className="body-small inline-flex shrink-0 items-center gap-6 text-[var(--color-text-secondary)]">
                  <CheckCircleIcon size={14} weight="fill" className="text-[var(--st-ok)]" aria-hidden />
                  Decided
                </span>
              ) : (
                <span className="body-small inline-flex shrink-0 items-center gap-6 text-[var(--st-wait)]">
                  <CircleDashedIcon size={14} weight="bold" aria-hidden />
                  To decide
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="body-small text-[var(--color-text-secondary)]">
          Every facility and credit batch on this template follows these decisions.
        </p>
      </ASection>
    </div>
  );
}

/* Facility, Isometric --------------------------------------------------------------------------- */

function AFacilityLink({ facility, registry, goTo }: Pick<APaneProps, "facility" | "registry" | "goTo">) {
  if (registry === "keys-missing") {
    return (
      <AReadRow
        label="Isometric facility"
        value="Not set. Waiting on the Isometric keys."
        action={<ATextAction onClick={() => goTo("registry")}>Open Registry</ATextAction>}
      />
    );
  }
  return (
    <FormField
      id="a-fcl"
      label="Isometric facility"
      helperText={facility.registryFacility ? undefined : "The facility ID from Isometric, starting with fcl_."}
      warning={
        registry === "failing" ? "Isometric cannot check this ID while the connection is failing." : undefined
      }
    >
      <FormInput id="a-fcl" defaultValue={facility.registryFacility ?? ""} placeholder="fcl_" />
    </FormField>
  );
}

export function AFacilityIsometricPane({ active, facility, registry, goTo }: APaneProps) {
  const [tier, setTier] = useState<string>(facility.durabilityTier);

  return (
    <div className="flex flex-col gap-24 content-measure-form">
      <AFacilityLink facility={facility} registry={registry} goTo={goTo} />

      <FormField
        id="a-fac-tier"
        label="Durability tier"
        helperText={`The registry's soil-permanence horizon for biochar from ${facility.name}.`}
      >
        <ChoiceCardGroup
          id="a-fac-tier"
          legend="Durability tier"
          options={TIER_OPTIONS}
          value={tier}
          onValueChange={setTier}
        />
      </FormField>

      {tier === "200-year" ? (
        <FormField
          id="a-soil-ref"
          label="Soil reference temperature"
          unit="°C"
          helperText="Annual average soil temperature from an approved dataset, such as SoilTemp. Air temperature is not accepted."
        >
          <FormInput
            id="a-soil-ref"
            type="number"
            step="0.1"
            defaultValue={facility.soilReferenceC ?? undefined}
          />
        </FormField>
      ) : (
        <p className="body-small text-[var(--color-text-tertiary)]">
          No soil reference temperature: only the 200-year model uses it.
        </p>
      )}

      {active.canManage && <ASaveRow />}

      <p className="body-small text-[var(--color-text-secondary)]">
        Project and default Removal template are set once for {active.name}.{" "}
        {registry !== "keys-missing" && <ATextAction onClick={() => goTo("registry")}>Open Registry</ATextAction>}
      </p>
    </div>
  );
}

/* Platform, Template mapping -------------------------------------------------------------------- */

export function ATemplateMappingPane() {
  return (
    <ul className="flex flex-col border-t border-[var(--clr-dark-purple-10)]">
      {fixtures.templateMapping.map((row) => (
        <li
          key={row.input}
          className="flex flex-col gap-2 border-b border-[var(--clr-dark-purple-10)] py-10 sm:flex-row sm:items-center sm:justify-between sm:gap-16"
        >
          <span className="body-medium">{row.input}</span>
          <span className="body-small text-[var(--color-text-secondary)]">{row.source}</span>
        </li>
      ))}
    </ul>
  );
}
