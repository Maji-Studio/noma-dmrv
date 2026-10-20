"use client";

/**
 * Throwaway: settings prototype variant E, "Platform as its own workspace".
 *
 * A Platform Admin signs in to a Platform workspace with its own navigation.
 * Opening an organization frames the app: a persistent coloured bar
 * "Platform Admin in <org> · Back to Platform" and a role marker. Inside, the
 * settings are minimal: Organization (General, Members, Registry, Developers)
 * and You (Profile, Connected apps).
 *
 * The product would frame the whole app, sidebar included. The prototype may
 * not touch the sidebar, so the frame wraps the content area.
 */
import { useState } from "react";
import { ArrowLeftIcon, ShieldCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { SegmentedControl } from "@/components/forms";
import { variantEFixtures, type VariantEOrg } from "./variant-e-fixtures";
import { VariantEOrgSettings } from "./variant-e-org";
import { VariantEPlatform } from "./variant-e-platform";

export const variantEName = "Platform workspace";

type VariantEState =
  | { kind: "platform" }
  | { kind: "org"; orgId: string; asPlatformAdmin: boolean };

const STATE_OPTIONS = [
  { value: "platform", label: "Platform home" },
  { value: "inside", label: "Inside an organization" },
  { value: "owner", label: "Owner's view" },
] as const;

const DEFAULT_ORG_ID = "mafinga";

export function VariantE() {
  const [orgs, setOrgs] = useState<VariantEOrg[]>(() => variantEFixtures.orgs.map((org) => ({ ...org })));
  const [state, setState] = useState<VariantEState>({ kind: "platform" });

  const org = state.kind === "org" ? orgs.find((o) => o.id === state.orgId) ?? orgs[0] : null;
  const framed = state.kind === "org" && state.asPlatformAdmin;

  const toggleApiAccess = (orgId: string) =>
    setOrgs((current) => current.map((o) => (o.id === orgId ? { ...o, apiAccess: !o.apiAccess } : o)));

  const open = (orgId: string) => {
    setOrgs((current) => current.map((o) => (o.id === orgId ? { ...o, lastOpened: "Just now" } : o)));
    setState({ kind: "org", orgId, asPlatformAdmin: true });
  };

  const stripValue = state.kind === "platform" ? "platform" : state.asPlatformAdmin ? "inside" : "owner";
  const onStrip = (value: string) => {
    const orgId = state.kind === "org" ? state.orgId : DEFAULT_ORG_ID;
    if (value === "platform") setState({ kind: "platform" });
    if (value === "inside") open(orgId);
    if (value === "owner") setState({ kind: "org", orgId, asPlatformAdmin: false });
  };

  return (
    <div className="flex min-h-full flex-col pb-96">
      <div className="flex flex-col gap-8 border-b border-dashed border-[var(--color-border-secondary)] px-16 py-12 md:flex-row md:items-center md:gap-12 md:px-24">
        <span className="body-caption font-medium text-[var(--color-text-tertiary)]">Prototype. State</span>
        <SegmentedControl
          legend="Prototype state"
          options={STATE_OPTIONS}
          value={stripValue}
          onValueChange={onStrip}
          className="md:w-[600px]"
        />
      </div>

      {state.kind === "platform" && (
        <VariantEPlatform orgs={orgs} onOpen={open} onToggleApiAccess={toggleApiAccess} />
      )}

      {org && (
        <div
          className={
            framed
              ? "flex flex-1 flex-col border-[3px] border-t-0 border-[var(--acc-infra-ink)]"
              : "flex flex-1 flex-col"
          }
        >
          {framed && (
            <div
              role="region"
              aria-label="Platform Admin mode"
              className="sticky top-0 z-10 flex flex-wrap items-center gap-x-16 gap-y-8 bg-[var(--acc-infra-ink)] px-16 py-8 text-white md:px-24"
            >
              <ShieldCheckIcon size={20} weight="bold" aria-hidden className="shrink-0" />
              <p className="body-small min-w-0 flex-1">
                <span className="font-medium">Platform Admin</span> in {org.name}
              </p>
              <Button
                size="small"
                onClick={() => setState({ kind: "platform" })}
                className="border-white text-white hover:bg-[var(--color-white-10)]"
              >
                <ArrowLeftIcon size={16} weight="bold" aria-hidden />
                Back to Platform
              </Button>
            </div>
          )}
          <VariantEOrgSettings
            key={`${org.id}-${framed ? "admin" : "owner"}`}
            org={org}
            asPlatformAdmin={framed}
            onToggleApiAccess={() => toggleApiAccess(org.id)}
          />
        </div>
      )}
    </div>
  );
}
