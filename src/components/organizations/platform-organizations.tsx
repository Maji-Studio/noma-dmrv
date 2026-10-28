/**
 * Platform: Organizations (#1373, variant C). A searchable list on the left;
 * the picked organization fills the right with what a Platform Admin does to
 * it. `?org=<id>` names the picked organization and `?org=new` opens the
 * create form, so a link can point at either. On a phone the list and the
 * panel stack, with a link back to the list.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import { ArrowLeftIcon, BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { Notice } from "@/components/ui/notice";
import { useToast } from "@/components/ui/toast";
import { useViewerOrg } from "@/components/navigation";
import { useBusyUntilUnload } from "@/hooks/use-busy-until-unload";
import { useEnterOrganization, usePlatformOrganizations } from "@/hooks/use-organizations";
import { orgSwitchFailedMessage } from "@/lib/org-switch-notice";
import { MEMBER_HOME_HREF } from "@/lib/auth/home-path";
import { cn } from "@/lib/utils";
import { CreateOrganizationForm, type CreatedOrganization } from "./create-organization-form";
import type { InvitationDelivery } from "./invitation-link-notice";
import { PlatformOrganizationDetail } from "./platform-organization-detail";
import { PlatformOrganizationList } from "./platform-organization-rows";

export const PLATFORM_ORGANIZATION_PARAM = "org";
const CREATE_KEY = "new";
/** Suffix on the held key while "Manage members" switches, so only that control spins. */
const MEMBERS_ACTION = "|members";

export function PlatformOrganizations() {
  const router = useRouter();
  const toast = useToast();
  const directory = usePlatformOrganizations();
  const enterOrganization = useEnterOrganization();
  // The switch holds its button busy until the page reloads into the organization.
  const switching = useBusyUntilUnload<string>();
  const currentId = useViewerOrg()?.organizationId ?? null;
  const [selectedKey, setSelectedKey] = useQueryState(
    PLATFORM_ORGANIZATION_PARAM,
    parseAsString.withOptions({ history: "replace" }),
  );
  const [query, setQuery] = useState("");
  const [lastInvitation, setLastInvitation] = useState<({ organizationId: string } & InvitationDelivery) | null>(null);

  const organizations = directory.data ?? [];
  const creating = selectedKey === CREATE_KEY;
  const selected = !creating && selectedKey ? organizations.find((org) => org.id === selectedKey) ?? null : null;
  const panelOpen = creating || selected !== null;

  async function switchTo(organizationId: string, organizationName: string, landingHref?: string) {
    if (organizationId === currentId) {
      router.push(landingHref ?? MEMBER_HOME_HREF);
      return;
    }
    if (switching.held) return;
    switching.hold(landingHref ? `${organizationId}${MEMBERS_ACTION}` : organizationId);
    try {
      const result = await enterOrganization(organizationId, organizationName, landingHref);
      if (!result.success) {
        switching.release();
        toast.error(orgSwitchFailedMessage(organizationName, result.error));
      }
    } catch {
      switching.release();
      toast.error(orgSwitchFailedMessage(organizationName));
    }
  }

  function onCreated(created: CreatedOrganization) {
    setLastInvitation(created.invitation ? { organizationId: created.organizationId, ...created.invitation } : null);
    void setSelectedKey(created.organizationId);
  }

  if (directory.isError) {
    return (
      <Notice
        tone="error"
        action={
          <Button type="button" variant="weak" size="small" busy={directory.isFetching} onClick={() => directory.refetch()}>
            Retry
          </Button>
        }
      >
        Organizations could not be loaded. Retry to see them.
      </Notice>
    );
  }

  if (directory.isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="grid grid-cols-1 gap-24 lg:grid-cols-[320px_minmax(0,1fr)]">
      <PlatformOrganizationList
        organizations={organizations}
        selectedId={selected?.id ?? null}
        creating={creating}
        currentId={currentId}
        query={query}
        onQueryChange={setQuery}
        onSelect={(id) => void setSelectedKey(id)}
        onCreate={() => void setSelectedKey(CREATE_KEY)}
        className={cn("self-start", panelOpen && "hidden lg:flex")}
      />

      <div className={cn("min-w-0 flex-col gap-12", panelOpen ? "flex" : "hidden lg:flex")}>
        {panelOpen && (
          <Button
            type="button"
            variant="noOutline"
            size="small"
            onClick={() => void setSelectedKey(null)}
            className="w-fit px-0 lg:hidden"
          >
            <ArrowLeftIcon size={16} aria-hidden /> All organizations
          </Button>
        )}
        {creating ? (
          <section aria-labelledby="new-organization-title" className="flex flex-col gap-20 border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] p-24">
            <h2 id="new-organization-title" className="title-heading-3">New organization</h2>
            <div className="content-measure-form">
              <CreateOrganizationForm onCreated={onCreated} onCancel={() => void setSelectedKey(null)} />
            </div>
          </section>
        ) : selected ? (
          <PlatformOrganizationDetail
            key={selected.id}
            organization={selected}
            current={selected.id === currentId}
            switching={
              switching.held === null
                ? null
                : switching.held === selected.id
                  ? "switch"
                  : switching.held === `${selected.id}${MEMBERS_ACTION}`
                    ? "members"
                    : "other"
            }
            onSwitch={(landingHref) => switchTo(selected.id, selected.name, landingHref)}
            invitation={lastInvitation?.organizationId === selected.id ? lastInvitation : null}
          />
        ) : organizations.length === 0 ? (
          <EmptyState
            icon={<BuildingsIcon size={40} />}
            title="No organizations yet"
            description="Create the first organization to onboard an operator."
            padding="md"
          />
        ) : (
          <EmptyState
            icon={<BuildingsIcon size={40} />}
            title="Pick an organization"
            description="Its Isometric keys, API access and members show here."
            padding="md"
          />
        )}
      </div>
    </div>
  );
}
