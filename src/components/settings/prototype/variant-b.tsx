"use client";

/**
 * Throwaway prototype variant B: two doors.
 *
 * Door 1 is the account menu in the sidebar footer (Profile, Connected apps,
 * Organizations with your role and a check, Platform for Platform Admins, Sign
 * out). Door 2 is ONE Organization page with a sticky table of contents.
 * Facility configuration lives on the facility sheet. `?b-page=` picks which
 * page the account menu opened.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRightIcon,
  PlugsConnectedIcon,
  PlusIcon,
  WarehouseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, Notice, PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { FormField, FormInput } from "@/components/forms";
import { fixtures, PROTOTYPE_SAVE_TOAST, type PrototypeFacility } from "./abd-fixtures";
import { enterAbdOrg, useAbdActiveOrg, type PrototypeActiveOrg } from "./abd-active-org";
import { PrototypeViewerToggle } from "./abd-viewer-toggle";
import { setSettingsPrototypeParams } from "./use-settings-prototype-variant";
import {
  B_SECTIONS,
  BDefaultsSection,
  BDeveloperAccessSection,
  BFacilitySheet,
  BGeneralSection,
  BMembersSection,
  BRegistrySection,
} from "./variant-b-sections";

export const variantBName = "Two doors";

type BPage = "organization" | "profile" | "connected-apps" | "platform" | "facilities";

function openPage(page: BPage, extra: Record<string, string | null> = {}) {
  setSettingsPrototypeParams({ "b-page": page === "organization" ? null : page, ...extra });
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Highlights the section nearest the top of the viewport. */
function useActiveSection(ids: readonly string[]): string {
  const [activeId, setActiveId] = useState<string>(ids[0]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return activeId;
}

const SECTION_IDS = B_SECTIONS.map((s) => s.id);

function RoleTag({ active }: { active: PrototypeActiveOrg }) {
  const loud = active.isPlatformAdminInside;
  return (
    <span
      className={`body-small inline-flex min-h-32 items-center border px-8 ${
        loud
          ? "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] text-[var(--st-wait)]"
          : "border-[var(--color-border-secondary)] text-[var(--color-text-secondary)]"
      }`}
    >
      Your role: {active.role}
    </span>
  );
}

function OrganizationPage({ active }: { active: PrototypeActiveOrg }) {
  const activeId = useActiveSection(SECTION_IDS);
  const openFacilities = () => openPage("facilities");

  return (
    <div className="container-max page-shell">
      <div className="flex max-w-[1160px] flex-col gap-16 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader eyebrow="Organization settings" title={active.name} actions={<RoleTag active={active} />} />
        <PrototypeViewerToggle />
      </div>

      <div className="grid max-w-[1160px] gap-24 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        {/* Table of contents: a sticky column on desktop, a sticky strip on phones. */}
        <nav
          aria-label="On this page"
          className="sticky top-56 z-10 -mx-16 overflow-x-auto border-b border-[var(--clr-dark-purple-10)] bg-[var(--bg)] px-16 md:top-0 lg:top-24 lg:mx-0 lg:overflow-visible lg:border-b-0 lg:bg-transparent lg:px-0"
        >
          <ol className="flex gap-4 lg:flex-col lg:gap-0 lg:border-l lg:border-[var(--clr-dark-purple-10)]">
            {B_SECTIONS.map((section) => {
              const current = section.id === activeId;
              return (
                <li key={section.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                    aria-current={current ? "location" : undefined}
                    className={`body-small flex min-h-44 items-center whitespace-nowrap border-b-[2px] px-8 lg:-ml-px lg:min-h-36 lg:border-b-0 lg:border-l-[2px] lg:px-12 ${
                      current
                        ? "border-[var(--clr-red)] text-[var(--color-text-primary)]"
                        : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    }`}
                  >
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-24 pb-96">
          <BGeneralSection active={active} />
          <BMembersSection active={active} />
          <BRegistrySection active={active} onOpenFacilities={openFacilities} />
          <BDefaultsSection active={active} />
          <BDeveloperAccessSection active={active} />
        </div>
      </div>
    </div>
  );
}

function ProfilePage({ active }: { active: PrototypeActiveOrg }) {
  const toast = useToast();
  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-16 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader eyebrow="Your account" title="Profile" />
        <PrototypeViewerToggle />
      </div>
      <div className="content-measure-form flex flex-col gap-24 border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] p-16 sm:p-24">
        <FormField id="b-profile-name" label="Name">
          <FormInput id="b-profile-name" defaultValue={active.user.name} autoComplete="name" />
        </FormField>
        <div className="flex flex-col gap-4">
          <span className="body-small text-[var(--color-text-secondary)]">Email</span>
          <span className="body-medium">{active.user.email}</span>
        </div>
        <div className="flex flex-wrap gap-12">
          <Button variant="primary" onClick={() => toast.info(PROTOTYPE_SAVE_TOAST)}>
            Save changes
          </Button>
          <Button onClick={() => toast.info(PROTOTYPE_SAVE_TOAST)}>Change password</Button>
        </div>
      </div>
    </div>
  );
}

function ConnectedAppsPage({ active }: { active: PrototypeActiveOrg }) {
  const toast = useToast();
  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-16 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader eyebrow="Your account" title="Connected apps" />
        <PrototypeViewerToggle />
      </div>
      <div className="content-measure-preview border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] p-16 sm:p-24">
        {active.isPlatformAdminInside ? (
          <EmptyState
            padding="md"
            icon={<PlugsConnectedIcon size={40} />}
            title="No connected apps"
            description="Platform Admins cannot connect apps. A member connects them."
          />
        ) : (
          <ul className="flex flex-col">
            {fixtures.connectedApps.map((app) => (
              <li key={app.id} className="flex flex-col gap-8 py-8 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex flex-col gap-2">
                  <span className="body-medium">{app.name}</span>
                  <span className="body-small text-[var(--color-text-secondary)]">
                    {app.permissions} in {app.org}, since {app.connected}
                  </span>
                </span>
                <Button variant="destructive" onClick={() => toast.info(PROTOTYPE_SAVE_TOAST)}>
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlatformPage({ active }: { active: PrototypeActiveOrg }) {
  const toast = useToast();
  if (active.viewer !== "platform-admin") {
    return (
      <div className="container-max page-shell">
        <div className="flex justify-end">
          <PrototypeViewerToggle />
        </div>
        <Notice tone="info">Platform is for Platform Admins. Switch the prototype view to see it.</Notice>
      </div>
    );
  }
  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-16 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          eyebrow="Platform"
          title="Organizations"
          actions={
            <Button variant="primary" onClick={() => toast.info(PROTOTYPE_SAVE_TOAST)}>
              <PlusIcon size={16} weight="bold" aria-hidden />
              Create organization
            </Button>
          }
        />
        <PrototypeViewerToggle />
      </div>
      <ul className="flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
        {fixtures.organizations.map((org) => {
          const current = org.id === active.id;
          return (
            <li key={org.id} className="border-b border-[var(--clr-dark-purple-10)] last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  enterAbdOrg("b-org", org.id, { "b-page": null });
                  toast.info(`Prototype: opened ${org.name}`);
                }}
                className="flex w-full flex-col gap-4 px-16 py-12 text-left hover:bg-[var(--sea)] sm:flex-row sm:items-center sm:gap-16 sm:px-24"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="body-medium">{org.name}</span>
                  <span className="body-small text-[var(--color-text-secondary)]">
                    {org.members} members, API access {org.apiAccess ? "on" : "off"}, Isometric keys{" "}
                    {org.keysSaved ? "saved" : "not saved"}
                  </span>
                </span>
                <span className="body-small text-[var(--color-text-tertiary)]">
                  {current ? "You are in it" : `Last opened ${org.lastOpened}`}
                </span>
                <span className="body-small inline-flex items-center gap-6 font-medium">
                  Open
                  <ArrowRightIcon size={14} weight="bold" aria-hidden />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <section className="flex flex-col gap-12">
        <h2 className="title-heading-3">Diagnostics</h2>
        <p className="body-small text-[var(--color-text-secondary)]">
          Last Isometric sync {fixtures.diagnostics.lastSync}. Failed submissions: {fixtures.diagnostics.failedSubmissions}.
          Template mapping is read only.
        </p>
      </section>
    </div>
  );
}

function FacilitiesPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const facility: PrototypeFacility | null = fixtures.facilities.find((f) => f.id === openId) ?? null;
  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-16 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader area="infrastructure" title="Facilities" />
        <PrototypeViewerToggle />
      </div>
      <ul className="flex flex-col border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
        {fixtures.facilities.map((f) => (
          <li key={f.id} className="border-b border-[var(--clr-dark-purple-10)] last:border-b-0">
            <button
              type="button"
              onClick={() => setOpenId(f.id)}
              className="flex w-full items-center gap-12 px-16 py-12 text-left hover:bg-[var(--sea)] sm:px-24"
            >
              <WarehouseIcon size={20} weight="bold" className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="body-medium">{f.name}</span>
                <span className="body-small text-[var(--color-text-secondary)]">
                  {f.durabilityTier}, {f.registryFacility ? "Isometric facility linked" : "No Isometric facility linked"}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <BFacilitySheet
        facility={facility}
        open={facility !== null}
        onOpenChange={(next) => !next && setOpenId(null)}
        onOpenRegistry={() => {
          setOpenId(null);
          openPage("organization");
          window.setTimeout(() => scrollToSection("b-registry"), 50);
        }}
      />
    </div>
  );
}

export function VariantB() {
  const params = useSearchParams();
  const active = useAbdActiveOrg("b-org");
  const page = (params.get("b-page") ?? "organization") as BPage;

  switch (page) {
    case "profile":
      return <ProfilePage active={active} />;
    case "connected-apps":
      return <ConnectedAppsPage active={active} />;
    case "platform":
      return <PlatformPage active={active} />;
    case "facilities":
      return <FacilitiesPage />;
    default:
      return <OrganizationPage active={active} />;
  }
}
