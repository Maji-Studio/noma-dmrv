"use client";

/**
 * Throwaway: the side sheet editor for one row of settings prototype variant C.
 * Every save is a stub that shows "Prototype: nothing saved".
 */
import { useState } from "react";
import Link from "next/link";
import { Button, buttonVariants, Input, Notice, SlideOverPanel } from "@/components/ui";
import { FormField, FormSelect, SegmentedControl } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  VARIANT_C_CHANGE_BY_LABEL,
  variantCFixtures,
  type VariantCOrg,
  type VariantCSetting,
  type VariantCViewer,
} from "./variant-c-fixtures";

const NOTHING_SAVED = "Prototype: nothing saved";

const DECISION_OPTIONS = ["Recorded in noma", "Fixed value", "Not applicable"] as const;

/** Kinds whose sheet holds a form that a Save button commits. */
const SAVE_KINDS = new Set([
  "text",
  "select",
  "segmented",
  "password",
  "keys",
  "members",
  "templateComponents",
]);

interface VariantCSheetProps {
  setting: VariantCSetting | null;
  scopeTitle: string;
  canChange: boolean;
  viewer: VariantCViewer;
  orgName: string;
  orgs: readonly VariantCOrg[];
  onClose: () => void;
  onOpenOrg: (orgId: string) => void;
}

export function VariantCSheet({
  setting,
  scopeTitle,
  canChange,
  viewer,
  orgName,
  orgs,
  onClose,
  onOpenOrg,
}: VariantCSheetProps) {
  const toast = useToast();
  const save = () => {
    toast.info(NOTHING_SAVED);
    onClose();
  };
  const showSave = setting !== null && canChange && SAVE_KINDS.has(setting.editor.kind);

  return (
    <SlideOverPanel.Root open={setting !== null} onOpenChange={(open) => !open && onClose()}>
      <SlideOverPanel.Content size="narrow">
        {setting && (
          <>
            <SlideOverPanel.Header>
              <SlideOverPanel.Title>{setting.label}</SlideOverPanel.Title>
              <SlideOverPanel.Description>{scopeTitle}</SlideOverPanel.Description>
            </SlideOverPanel.Header>
            <SlideOverPanel.Body>
              <div className="flex flex-col gap-20">
                {!canChange && (
                  <Notice tone="info" boxed>
                    {setting.memberOnly && viewer === "platform"
                      ? `${setting.label} belong to members. You are in ${orgName} as Platform Admin.`
                      : `${VARIANT_C_CHANGE_BY_LABEL[setting.changeBy]} can change this.`}
                  </Notice>
                )}
                <SheetEditor
                  setting={setting}
                  canChange={canChange}
                  orgName={orgName}
                  orgs={orgs}
                  onOpenOrg={onOpenOrg}
                />
              </div>
            </SlideOverPanel.Body>
            {showSave && (
              <SlideOverPanel.Footer>
                <Button variant="primary" onClick={save}>
                  Save
                </Button>
                <Button onClick={onClose}>Cancel</Button>
              </SlideOverPanel.Footer>
            )}
          </>
        )}
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}

function SegmentedEditor({
  id,
  legend,
  disabled,
  initial,
  options,
}: {
  id: string;
  legend: string;
  disabled: boolean;
  initial: string;
  options: readonly string[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      id={id}
      legend={legend}
      disabled={disabled}
      value={value}
      onValueChange={setValue}
      options={options.map((option) => ({ value: option, label: option }))}
    />
  );
}

function SheetEditor({
  setting,
  canChange,
  orgName,
  orgs,
  onOpenOrg,
}: {
  setting: VariantCSetting;
  canChange: boolean;
  orgName: string;
  orgs: readonly VariantCOrg[];
  onOpenOrg: (orgId: string) => void;
}) {
  const toast = useToast();
  const id = `variant-c-${setting.id}`;
  const editor = setting.editor;
  const disabled = !canChange;

  switch (editor.kind) {
    case "text":
      return (
        <FormField id={id} label={setting.label}>
          <Input id={id} type={editor.inputType ?? "text"} defaultValue={setting.value} disabled={disabled} />
        </FormField>
      );
    case "select":
      return (
        <FormField id={id} label={setting.label}>
          <FormSelect
            id={id}
            defaultValue={setting.value}
            disabled={disabled}
            options={editor.options.map((option) => ({ value: option, label: option }))}
          />
        </FormField>
      );
    case "segmented":
      return (
        <FormField id={id} label={setting.label}>
          <SegmentedEditor
            id={id}
            legend={setting.label}
            disabled={disabled}
            initial={setting.value}
            options={editor.options}
          />
        </FormField>
      );
    case "password":
      return (
        <div className="flex flex-col gap-16">
          <FormField id={`${id}-current`} label="Current password">
            <Input id={`${id}-current`} type="password" autoComplete="current-password" />
          </FormField>
          <FormField id={`${id}-new`} label="New password" cue="At least 12 characters.">
            <Input id={`${id}-new`} type="password" autoComplete="new-password" />
          </FormField>
        </div>
      );
    case "keys":
      return (
        <div className="flex flex-col gap-16">
          <p className="body-small">
            <span className="text-[var(--color-text-secondary)]">Status: </span>
            {setting.value}
          </p>
          <FormField id={`${id}-client`} label="Client ID">
            <Input id={`${id}-client`} disabled={disabled} autoComplete="off" />
          </FormField>
          <FormField id={`${id}-secret`} label="Client secret">
            <Input id={`${id}-secret`} type="password" disabled={disabled} autoComplete="off" />
          </FormField>
          <p className="body-caption text-[var(--color-text-tertiary)]">
            One set of keys for every facility in {orgName}.
          </p>
        </div>
      );
    case "members":
      return (
        <div className="flex flex-col gap-20">
          <ul className="flex flex-col">
            {variantCFixtures.members.map((member) => (
              <li
                key={member.name}
                className="flex min-h-44 items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-6"
              >
                <span className="body-small min-w-0 truncate">{member.name}</span>
                {canChange && member.role !== "Owner" ? (
                  <FormSelect
                    aria-label={`Role of ${member.name}`}
                    defaultValue={member.role}
                    className="w-[120px] shrink-0"
                    options={["Admin", "Member"].map((role) => ({ value: role, label: role }))}
                  />
                ) : (
                  <span className="body-small shrink-0 text-[var(--color-text-secondary)]">{member.role}</span>
                )}
              </li>
            ))}
            <li className="flex min-h-44 items-center justify-between gap-12 py-6">
              <span className="body-small min-w-0 truncate text-[var(--color-text-secondary)]">
                {variantCFixtures.pendingInvitation}
              </span>
              <span className="body-caption shrink-0 text-[var(--color-text-tertiary)]">Invited 9 Oct</span>
            </li>
          </ul>
          {canChange && (
            <div className="flex flex-col gap-8">
              <FormField id={`${id}-invite`} label="Invite by email">
                <Input id={`${id}-invite`} type="email" placeholder="name@example.com" />
              </FormField>
              <div>
                <Button onClick={() => toast.info(NOTHING_SAVED)}>Send invitation</Button>
              </div>
            </div>
          )}
        </div>
      );
    case "templateComponents":
      return (
        <div className="flex flex-col gap-16">
          <p className="body-small text-[var(--color-text-secondary)]">
            Biochar Removal 2026. Components to decide block Removals.
          </p>
          {variantCFixtures.templateComponents.map((component, index) => (
            <FormField key={component.name} id={`${id}-${index}`} label={component.name}>
              <FormSelect
                id={`${id}-${index}`}
                disabled={disabled}
                defaultValue={component.decided ? DECISION_OPTIONS[0] : ""}
                placeholder="Decide"
                options={DECISION_OPTIONS.map((option) => ({ value: option, label: option }))}
              />
            </FormField>
          ))}
        </div>
      );
    case "linkOut":
      return (
        <div className="flex flex-col gap-16">
          <p className="body-small text-[var(--color-text-secondary)]">{editor.body}</p>
          <div>
            <Link href={editor.href} className={buttonVariants({ variant: "default" })}>
              {editor.linkLabel}
            </Link>
          </div>
        </div>
      );
    case "notApplicable":
      return <Notice tone="info">{editor.body}</Notice>;
    case "connectedApps":
      return disabled ? null : (
        <ul className="flex flex-col">
          <li className="flex min-h-44 items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-6">
            <div className="flex min-w-0 flex-col">
              <span className="body-small">Claude</span>
              <span className="body-caption text-[var(--color-text-tertiary)]">Read and record data in {orgName}</span>
            </div>
            <Button size="small" onClick={() => toast.info(NOTHING_SAVED)}>
              Disconnect
            </Button>
          </li>
        </ul>
      );
    case "apiKeys":
      return disabled ? null : (
        <div className="flex flex-col gap-16">
          <ul className="flex flex-col">
            {["Production sync", "Lab import"].map((key) => (
              <li
                key={key}
                className="flex min-h-44 items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-6"
              >
                <span className="body-small min-w-0 truncate">{key}</span>
                <Button size="small" variant="destructive" onClick={() => toast.info(NOTHING_SAVED)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button onClick={() => toast.info(NOTHING_SAVED)}>Create API key</Button>
          </div>
        </div>
      );
    case "checks":
      return (
        <ul className="flex flex-col">
          {variantCFixtures.diagnostics.map((row) => (
            <li
              key={row.check}
              className="flex min-h-44 items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-6"
            >
              <span className="body-small min-w-0">{row.check}</span>
              <span
                className={cn(
                  "body-small shrink-0",
                  row.result === "Passing" ? "text-[var(--st-ok)]" : "text-[var(--st-wait)]",
                )}
              >
                {row.result}
              </span>
            </li>
          ))}
        </ul>
      );
    case "organizations":
      return (
        <div className="flex flex-col gap-16">
          <ul className="flex flex-col">
            {orgs.map((org) => (
              <li
                key={org.id}
                className="flex min-h-44 items-center justify-between gap-12 border-b border-[var(--clr-dark-purple-10)] py-6"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="body-small">{org.name}</span>
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {org.facilities.length === 1 ? "1 facility" : `${org.facilities.length} facilities`}
                  </span>
                </div>
                <Button size="small" onClick={() => onOpenOrg(org.id)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button onClick={() => toast.info(NOTHING_SAVED)}>Create organization</Button>
          </div>
        </div>
      );
  }
}
