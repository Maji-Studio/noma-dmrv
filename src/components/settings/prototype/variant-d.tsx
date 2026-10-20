"use client";

/**
 * Throwaway prototype variant D: facility first.
 *
 * A segmented switch at the top picks whose settings: "Organization" or
 * "Facility: Mafinga ▾" (Platform Admins also get "Platform"). The facility
 * side is one page per facility with everything that varies per site. The
 * sidebar org name is always a switcher with your role chip, and your own
 * account lives in the footer popover.
 */
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  BuildingsIcon,
  CaretDownIcon,
  CheckIcon,
  GlobeIcon,
  WarehouseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { DropdownMenu, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fixtures } from "./abd-fixtures";
import { enterAbdOrg, useAbdActiveOrg } from "./abd-active-org";
import { PrototypeViewerToggle } from "./abd-viewer-toggle";
import { setSettingsPrototypeParams } from "./use-settings-prototype-variant";
import {
  D_ORG_TABS,
  DFacilityPage,
  DOrgTabPanel,
  DPlatformPage,
  type DOrgTab,
} from "./variant-d-panels";

export const variantDName = "Facility first";

type DSide = "organization" | "facility" | "platform";

function segmentClass(selected: boolean): string {
  return `flex min-h-44 min-w-0 items-center justify-center gap-8 border px-16 text-left transition-colors ${
    selected
      ? "border-[var(--color-interaction)] bg-[var(--paper)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_var(--color-interaction)]"
      : "border-[var(--color-border-secondary)] bg-[var(--paper)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-primary)] hover:text-[var(--color-text-primary)]"
  }`;
}

function SegmentLabel({ icon: SegIcon, children }: { icon: Icon; children: ReactNode }) {
  return (
    <>
      <SegIcon size={16} weight="bold" className="shrink-0" aria-hidden />
      <span className="body-small min-w-0 truncate">{children}</span>
    </>
  );
}

export function VariantD() {
  const params = useSearchParams();
  const toast = useToast();
  const active = useAbdActiveOrg("d-org");
  const isPlatformAdmin = active.viewer === "platform-admin";

  const requestedSide = (params.get("d-side") ?? "facility") as DSide;
  const side: DSide = requestedSide === "platform" && !isPlatformAdmin ? "facility" : requestedSide;
  const facility = fixtures.facilities.find((f) => f.id === params.get("d-facility")) ?? fixtures.facilities[0];
  const tab = (D_ORG_TABS.find((t) => t.key === params.get("d-tab"))?.key ?? "members") as DOrgTab;

  const setSide = (next: DSide, extra: Record<string, string | null> = {}) =>
    setSettingsPrototypeParams({ "d-side": next === "facility" ? null : next, ...extra });

  const title = side === "organization" ? active.name : side === "facility" ? facility.name : "Platform";
  const eyebrow =
    side === "organization" ? "Organization settings" : side === "facility" ? "Facility settings" : "Platform";

  return (
    <div className="container-max page-shell">
      <div className="flex max-w-[1160px] flex-col gap-16 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader eyebrow={eyebrow} title={title} />
        <PrototypeViewerToggle />
      </div>

      <div
        role="group"
        aria-label="Whose settings"
        className={`grid max-w-[1160px] gap-2 ${isPlatformAdmin ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}
      >
        <button
          type="button"
          aria-pressed={side === "organization"}
          onClick={() => setSide("organization")}
          className={segmentClass(side === "organization")}
        >
          {side === "organization" && <CheckIcon size={12} weight="bold" aria-hidden />}
          <SegmentLabel icon={BuildingsIcon}>Organization: {active.name}</SegmentLabel>
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            render={<button type="button" aria-pressed={side === "facility"} className={segmentClass(side === "facility")} />}
          >
            {side === "facility" && <CheckIcon size={12} weight="bold" aria-hidden />}
            <SegmentLabel icon={WarehouseIcon}>Facility: {facility.name}</SegmentLabel>
            <CaretDownIcon size={12} weight="bold" className="shrink-0" aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" className="w-[260px]">
            {fixtures.facilities.map((f) => (
              <DropdownMenu.Item
                key={f.id}
                onClick={() =>
                  setSide("facility", { "d-facility": f.id === fixtures.facilities[0].id ? null : f.id })
                }
              >
                <span className="flex w-16 shrink-0 justify-center">
                  {side === "facility" && f.id === facility.id && <CheckIcon size={14} weight="bold" aria-label="Current" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="body-caption text-[var(--color-text-tertiary)]">{f.durabilityTier}</span>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {isPlatformAdmin && (
          <button
            type="button"
            aria-pressed={side === "platform"}
            onClick={() => setSide("platform")}
            className={segmentClass(side === "platform")}
          >
            {side === "platform" && <CheckIcon size={12} weight="bold" aria-hidden />}
            <SegmentLabel icon={GlobeIcon}>Platform</SegmentLabel>
          </button>
        )}
      </div>

      <div className="max-w-[1160px]">
        {side === "facility" && <DFacilityPage facility={facility} canManage={active.canManage} />}

        {side === "organization" && (
          <div className="flex flex-col gap-16">
            <div role="tablist" aria-label="Organization settings" className="flex overflow-x-auto border-b border-[var(--clr-dark-purple-10)]">
              {D_ORG_TABS.map((t) => {
                const selected = t.key === tab;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSettingsPrototypeParams({ "d-tab": t.key === "members" ? null : t.key })}
                    className={`body-small -mb-px flex min-h-44 shrink-0 items-center whitespace-nowrap border-b-[2px] px-12 ${
                      selected
                        ? "border-[var(--clr-red)] text-[var(--color-text-primary)]"
                        : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" aria-label={D_ORG_TABS.find((t) => t.key === tab)?.label}>
              <DOrgTabPanel tab={tab} active={active} />
            </div>
          </div>
        )}

        {side === "platform" && (
          <DPlatformPage
            activeId={active.id}
            onOpen={(orgId) => {
              const org = fixtures.organizations.find((o) => o.id === orgId);
              enterAbdOrg("d-org", orgId, { "d-side": "organization" });
              toast.info(`Prototype: opened ${org?.name ?? "organization"}`);
            }}
          />
        )}
      </div>
    </div>
  );
}
