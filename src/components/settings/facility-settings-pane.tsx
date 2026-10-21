/**
 * Settings, Facilities: the certification settings of the working facility
 * (Q14: the facility follows the sidebar's selector, there is no second
 * picker here). Its registry project link, its durability tier (Q9, moved out
 * of the facility form) and the reference soil temperature.
 *
 * The soil reference only feeds the 200-year model, so on the 1000-year tier
 * it is hidden behind one quiet line instead of a "Not used" notice (Q11).
 * Site details (name, country, timezone, address) stay in the facility form.
 */
"use client";

import { useContext, useState, type ContextType } from "react";
import { EmissionEstimatesForm } from "@/components/admin/emission-estimates-form";
import { FacilityCertifierSection } from "@/components/certification/facility-certifier-section";
import { SelectFacilityEmptyState } from "@/components/navigation";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { DetailField } from "@/components/ui/detail-panel";
import { ServerError } from "@/components/forms";
import { FormDialogContext } from "@/components/ui/form-dialog-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useFacilityContext } from "@/hooks/use-facility-context";
import type { SettingsViewer } from "@/lib/settings/panes";
import { DurabilityTierSettings } from "./durability-tier-settings";
import { Notice } from "@/components/ui/notice";
import { PaneSection } from "./pane-section";

/** The durability tier the soil reference temperature is configuration for. */
const SOIL_MODELLED_TIER = "200_year";

export const SOIL_REFERENCE_NOT_USED_TEXT =
  "No soil reference temperature: only the 200-year model uses it.";
/** The soil reference is stored on the registry project link. */
export const SOIL_REFERENCE_NEEDS_LINK_TEXT =
  "Link the registry project above to set the reference soil temperature.";

/** Why the tier cannot be saved while a soil reference draft is open. */
export const SOIL_DRAFT_BLOCKS_TIER_TEXT =
  "Save or undo the reference soil temperature first. Changing the tier closes that form and drops the unsaved value.";

type DialogActions = NonNullable<ContextType<typeof FormDialogContext>>;

/**
 * Passes a form's dirty reports on to the pane guard and keeps a copy, so a
 * sibling can tell that this form holds a draft.
 */
function useTrackedDraft(): { dirty: boolean; actions: DialogActions } {
  const parent = useContext(FormDialogContext);
  const [dirty, setDirty] = useState(false);
  return {
    dirty,
    actions: {
      cancel: () => parent?.cancel(),
      markSaved: (id) => {
        setDirty(false);
        parent?.markSaved(id);
      },
      report: (id, state) => {
        setDirty(!!state?.dirty);
        parent?.report(id, state);
      },
    },
  };
}

export function FacilitySettingsPane({ viewer }: { viewer: SettingsViewer }) {
  const { facilityId, selectedFacility } = useFacilityContext();
  const { data: summary, isLoading, error } = useFacilityCertifierSummary(
    facilityId ?? "",
    !!facilityId,
  );

  // A tier change unmounts the soil form, so its draft blocks the tier save.
  const soilDraft = useTrackedDraft();

  if (!facilityId || !selectedFacility) {
    return (
      <SelectFacilityEmptyState description="Choose a facility from the sidebar to configure its certification settings." />
    );
  }

  const canManage = viewer.canManage;
  const soilModelled = selectedFacility.durabilityOption === SOIL_MODELLED_TIER;

  return (
    <div className="flex flex-col gap-24">
      <PaneSection title="Registry project">
        <FacilityCertifierSection
          key={`facility-certifier-${facilityId}`}
          facilityId={facilityId}
          canManage={canManage}
          embedded
        />
      </PaneSection>

      <PaneSection>
        <DurabilityTierSettings
          facility={selectedFacility}
          canManage={canManage}
          blockedReason={soilDraft.dirty ? SOIL_DRAFT_BLOCKS_TIER_TEXT : undefined}
        />
        {!soilModelled ? (
          <p className="body-small text-[var(--color-text-tertiary)]">{SOIL_REFERENCE_NOT_USED_TEXT}</p>
        ) : isLoading ? (
          <Skeleton className="h-160 w-full" />
        ) : error || !summary ? (
          <ServerError message="Couldn't load the soil reference temperature. Refresh the page to retry." />
        ) : !summary.mapping ? (
          <Notice tone="info">{SOIL_REFERENCE_NEEDS_LINK_TEXT}</Notice>
        ) : canManage ? (
          // The form seeds its defaultValues from `mapping` at mount, so it
          // must not mount before the summary lands or saved values render blank.
          <FormDialogContext.Provider value={soilDraft.actions}>
            <EmissionEstimatesForm
              key={`emission-estimates-${facilityId}`}
              facilityId={facilityId}
              mapping={summary.mapping ?? null}
              durabilityOption={SOIL_MODELLED_TIER}
            />
          </FormDialogContext.Provider>
        ) : (
          <DetailField
            label="Reference soil temperature (°C)"
            value={summary.mapping?.defaultSoilTemperatureC ?? null}
            emptySituation="notSet"
          />
        )}
      </PaneSection>
    </div>
  );
}
