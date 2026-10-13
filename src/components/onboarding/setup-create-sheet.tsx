"use client";

import { useState } from "react";
import { FacilityForm } from "@/components/facilities/facility-form";
import { ReactorForm } from "@/components/reactors/reactor-form";
import { EntitySideSheet } from "@/components/ui/entity-side-sheet";
import { useToast } from "@/components/ui/toast";
import { useCreateFacility } from "@/hooks/use-facilities";
import { useCreateReactor } from "@/hooks/use-reactors";
import { useFacilityContext } from "@/hooks/use-facility-context";
import type { FacilityFormData } from "@/schemas/facilities";
import type { CreateReactorData } from "@/schemas/reactors";

/** Reuses the list pages' forms, sheet chrome, and create mutations. */
export function SetupCreateSheet({
  entity,
  onClose,
}: {
  entity: "facility" | "reactor";
  onClose: () => void;
}) {
  const createFacility = useCreateFacility();
  const createReactor = useCreateReactor();
  const { setFacilityId } = useFacilityContext();
  const toast = useToast();
  const [error, setError] = useState<string>();
  const busy = createFacility.isPending || createReactor.isPending;

  async function saveFacility(data: FacilityFormData) {
    setError(undefined);
    try {
      const facility = await createFacility.mutateAsync(data);
      setFacilityId(facility.id);
      toast.success("Facility created.");
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Facility was not created. Check the form.");
    }
  }

  async function saveReactor(data: CreateReactorData) {
    setError(undefined);
    try {
      await createReactor.mutateAsync(data);
      toast.success("Reactor created.");
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Reactor was not created. Check the form.");
    }
  }

  return (
    <EntitySideSheet
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      onCloseAttempt={() => !busy}
      mode="create"
      onModeChange={() => undefined}
      title={entity === "facility" ? "Create facility" : "Create reactor"}
    >
      {entity === "facility" ? (
        <FacilityForm onSubmit={saveFacility} onCancel={onClose} isSubmitting={busy} errorMessage={error} />
      ) : (
        <ReactorForm onSubmit={saveReactor} onCancel={onClose} isSubmitting={busy} errorMessage={error} />
      )}
    </EntitySideSheet>
  );
}
