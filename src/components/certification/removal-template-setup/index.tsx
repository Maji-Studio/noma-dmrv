/**
 * Removal template setup page body: reads the facility's templates live from
 * Isometric (nothing is stored), then hands them to the flow. A reload after a
 * stale refusal remounts the flow so every choice starts from the new read.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useRemovalTemplateSetup } from "@/hooks/use-removal-template-setup";
import { certificationRemovalTemplatesHref } from "@/lib/certification/links";
import { parseStep } from "@/lib/certification/removal-template-setup-copy";
import { RemovalTemplateSetupFlow } from "./setup-flow";

const BACK_LINK_CLASS = "inline-flex min-h-44 items-center gap-6 self-start body-small text-[var(--color-text-secondary)] underline-offset-2 hover:underline";

export interface RemovalTemplateSetupPageProps {
  facilityParam?: string;
  templateParam?: string;
  stepParam?: string;
  makeDefaultParam?: string;
}

export function RemovalTemplateSetupPage({ facilityParam, templateParam, stepParam, makeDefaultParam }: RemovalTemplateSetupPageProps) {
  const { facilityId: contextFacilityId, isLoading, isResolving } = useFacilityContext();
  const facilityId = facilityParam ?? contextFacilityId ?? "";
  const query = useRemovalTemplateSetup(facilityId, !!facilityId);
  const [reloads, setReloads] = useState(0);

  if (!facilityId) {
    return isLoading || isResolving ? <div className="container-max page-shell"><Skeleton className="h-160 w-full" /></div> : <SelectFacilityEmptyState description="Choose a facility to set up its Removal template." />;
  }
  const settingsHref = certificationRemovalTemplatesHref(facilityId);
  const reload = async () => {
    await query.refetch();
    setReloads((count) => count + 1);
  };

  return (
    <div className="container-max page-shell">
      <div className="flex flex-col gap-20">
        <Link href={settingsHref} className={BACK_LINK_CLASS}>
          <ArrowLeftIcon size={16} aria-hidden />
          Settings
        </Link>
        <PageHeader area="certification" title="Set up Removal template" subtitle={query.data?.facility.name} />
      </div>
      {query.isError ? (
        <ServerError
          message="The Removal templates could not be read from Isometric."
          action={<Button size="small" busy={query.isFetching} onClick={() => void query.refetch()}>Try again</Button>}
        />
      ) : !query.data ? (
        <div className="flex flex-col gap-16" aria-busy="true" aria-label="Loading Removal templates">
          <Skeleton className="h-160 w-full" />
          <Skeleton className="h-160 w-full" />
        </div>
      ) : (
        <RemovalTemplateSetupFlow
          key={reloads}
          data={query.data}
          facilityId={facilityId}
          templateId={templateParam ?? null}
          step={parseStep(stepParam)}
          makeDefault={makeDefaultParam !== "false"}
          onReload={() => void reload()}
        />
      )}
    </div>
  );
}
