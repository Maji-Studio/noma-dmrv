/** Application side-sheet view mode: the sections config for EntitySideSheet. */
import { ApplicationAllocationShares } from "./application-allocation-shares";
import { ServerError } from "@/components/forms";
import { Button } from "@/components/ui";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { formatDate } from "@/lib/format-utils";
import { formatApplicationEvidenceMethod, formatApplicationMethod, formatSoilTemperatureSource, type ApplicationEvidenceMethod, type ApplicationMethod, type SoilTemperatureSource } from "@/schemas/applications";
import { ApplicationEvidencePanel } from "./application-evidence-panel";
import { ApplicationStorageLocationSync } from "./application-storage-location-sync";
import { ApplicationSupportingEvidencePanel } from "./application-supporting-evidence-panel";
import { formatApplicationDeliveryDay, formatApplicationKgFromTons, formatFieldSizeHa } from "./mass-utils";
import type { DetailPanelSection } from "@/components/ui/detail-panel";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ApplicationListItem } from "@/data-access/applications";
import type { ApplicationDeliveryOption } from "./mass-utils";
import { Notice } from "@/components/ui/notice";

/** What the sheet knows besides the application: its delivery, the certification lock query and the facility durability. */
export interface ApplicationSheetContext {
  delivery: Pick<ApplicationDeliveryOption, "productBinName" | "formulationName" | "deliveryDate" | "deliveryDay"> | undefined;
  lock: Pick<UseQueryResult<unknown>, "data" | "isPending" | "error" | "isFetching" | "refetch">;
  durabilityOption: string;
}

/** Mix-bin biochar is recorded as usual but feeds no credit batch until the PDD covers mixing (ADR 0030). */
const MIX_BIN_CREDIT_HOLD_NOTICE = "Not in a credit batch: this biochar was drawn from a mix bin. Mix-bin biochar is held out of credit batches until the project design document (PDD) covers mixing.";

/** "-8.1, 35.2", or null when either coordinate is missing. */
function formatFieldPosition(
  latitude: number | null,
  longitude: number | null,
): string | null {
  if (latitude == null || longitude == null) return null;
  return `${latitude}, ${longitude}`;
}

export function applicationSheetSections(application: ApplicationListItem, context: ApplicationSheetContext): DetailPanelSection[] {
  return [
    {
      title: "Application details",
      fields: [
        { label: "Application date", value: formatDate(application.applicationDate) },
        {
          label: "Delivery source",
          value: context.delivery
            ? `${
                context.delivery.productBinName ??
                context.delivery.formulationName ??
                "Biochar delivery"
              } · ${formatApplicationDeliveryDay(context.delivery)}`
            : null,
        },
        {
          label: "Biochar product applied",
          ...certificationDetailField("application", "biocharAppliedTons"),
          value: application.biocharAppliedTons != null
            ? formatApplicationKgFromTons(application.biocharAppliedTons)
            : null,
          secondary: {
            label: "Dry biochar applied",
            ...certificationDetailField("application", "biocharAppliedDryTons"),
            value: application.biocharAppliedDryTons != null
              ? formatApplicationKgFromTons(application.biocharAppliedDryTons)
              : null,
          },
        },
      ],
      content: application.heldOutOfCredits
        ? <Notice>{MIX_BIN_CREDIT_HOLD_NOTICE}</Notice>
        : undefined,
    },
    ...(application.allocationShares.length > 0 ? [{
      // The bar and key line show at both levels; the ledger and source
      // runs are the block's explanation, so Detailed only.
      title: "Batch shares",
      fields: [],
      content: <ApplicationAllocationShares shares={application.allocationShares} />,
    }] : []),
    {
      title: "Field details",
      fields: [
        { label: "Field size", value: formatFieldSizeHa(application.fieldSizeHa) },
        { label: "Field identifier", value: application.fieldIdentifier },
        { label: "Crop type", value: application.cropType },
        {
          label: "Application method",
          value: application.applicationMethodType
            ? formatApplicationMethod(application.applicationMethodType as ApplicationMethod)
            : null,
        },
        {
          label: "Field position",
          value: formatFieldPosition(
            application.gpsLatitude,
            application.gpsLongitude,
          ),
        },
      ],
    },
    {
      title: "Evidence method",
      fields: [
        {
          label: "Evidence method",
          value: formatApplicationEvidenceMethod(
            (application.evidenceMethod ?? "location") as ApplicationEvidenceMethod,
          ),
        },
      ],
      content: (
        <ApplicationEvidencePanel
          mode={(application.evidenceMethod ?? "location") as ApplicationEvidenceMethod}
          boundary={application.gisBoundary ?? null}
          readOnly
        />
      ),
    },
    {
      title: "Supporting evidence",
      fields: context.lock.data ? [{ label: "Certification", value: "Application fields are locked by certification. Supporting uploads are saved separately; including new evidence requires a Removal evidence review." }] : context.lock.isPending ? [{ label: "Certification", value: "Checking whether Application fields can be edited." }] : [],
      content: (
        <>
          {context.lock.error && (
            <div className="flex flex-col gap-8">
              <ServerError message="The certification lock could not be checked. Fields remain view-only until the check succeeds." />
              <Button type="button" variant="weak" disabled={context.lock.isFetching} onClick={() => void context.lock.refetch()}>Retry certification check</Button>
            </div>
          )}
          <ApplicationSupportingEvidencePanel applicationId={application.id} />
        </>
      ),
    },
    {
      title: "Application site",
      fields: [],
      content: (
        <ApplicationStorageLocationSync
          applicationId={application.id}
        />
      ),
    },
    ...((application.durabilityOption ?? context.durabilityOption) === "1000_year" ? [] : [{
      title: "Soil temperature",
      fields: [
        {
          label: "Temperature source",
          value: application.soilTemperatureSource
            ? formatSoilTemperatureSource(application.soilTemperatureSource as SoilTemperatureSource)
            : null,
        },
        {
          label: "Soil temperature (°C)",
          ...certificationDetailField("application", "soilTemperatureC"),
          value: application.soilTemperatureC != null
            ? `${application.soilTemperatureC} °C`
            : null,
        },
      ],
    }]),
  ];
}
