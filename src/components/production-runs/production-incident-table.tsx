/**
 * ProductionIncidentTable component
 * Production incident table with dialog-based add/edit forms within a
 * production run.
 */
"use client";

import { useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useProductionIncidents,
  useCreateProductionIncident,
  useUpdateProductionIncident,
  useDeleteProductionIncident,
} from "@/hooks/use-production-incidents";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { ProductionIncidentForm } from "./production-incident-form";
import {
  formatProductionIncidentSeverity,
  type ProductionIncidentFormData,
} from "@/schemas/production-incidents";
import type { ProductionIncidentWithRelations } from "@/data-access/production-incidents";
import { formatDateTime } from "@/lib/format-utils";

interface ProductionIncidentTableProps {
  productionRunId: string;
  facilityId?: string;
  defaultReactorId?: string | null;
  defaultOperatorId?: string | null;
  readOnly?: boolean;
}

export function ProductionIncidentTable({
  productionRunId,
  facilityId,
  defaultReactorId,
  defaultOperatorId,
  readOnly = false,
}: ProductionIncidentTableProps) {
  const { data: incidents, isLoading, error } = useProductionIncidents(productionRunId);
  const createIncident = useCreateProductionIncident();
  const updateIncident = useUpdateProductionIncident();
  const deleteIncident = useDeleteProductionIncident(productionRunId);
  const toast = useToast();

  const [formDialog, setFormDialog] = useState<
    | { open: false }
    | { open: true; incident?: ProductionIncidentWithRelations }
  >({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreate = () => {
    setFormError(null);
    setFormDialog({ open: true });
  };
  const openEdit = (incident: ProductionIncidentWithRelations) => {
    setFormError(null);
    setFormDialog({ open: true, incident });
  };
  const closeForm = () => {
    setFormDialog({ open: false });
    setFormError(null);
  };

  const handleSubmit = async (data: ProductionIncidentFormData) => {
    setFormError(null);
    try {
      if (formDialog.open && formDialog.incident) {
        await updateIncident.mutateAsync({
          productionIncidentId: formDialog.incident.id,
          ...data,
        });
        toast.success("Incident updated");
      } else {
        await createIncident.mutateAsync(data);
        toast.success("Incident added");
      }
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save incident");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      await deleteIncident.mutateAsync(deletingId);
      setDeletingId(null);
      toast.success("Incident deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete incident");
      setDeletingId(null);
    }
  };

  const isSubmitting = createIncident.isPending || updateIncident.isPending;
  const closeDialog = () => {
    if (!isSubmitting) closeForm();
  };

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Production Incidents
        </h3>
        {!readOnly && !formDialog.open && (
          <Button variant="default" size="small" onClick={openCreate}>
            <PlusIcon size={16} weight="bold" />
            Add Incident
          </Button>
        )}
      </div>

      {error && <ServerError message={error.message} />}

      {isLoading ? (
        <TableSkeleton columns={readOnly ? 5 : 6} rows={3} />
      ) : !incidents?.length && !formDialog.open ? (
        <p className="body-small py-16 text-[var(--color-text-tertiary)]">
          {readOnly
            ? "No incidents recorded yet."
            : "No incidents recorded yet. Use this section to log production issues and corrective actions."}
        </p>
      ) : incidents?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full body-small">
            <thead>
              <tr className="border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-tertiary)]">
                <th className="py-8 pr-12 font-medium">Time</th>
                <th className="py-8 pr-12 font-medium">Severity</th>
                <th className="py-8 pr-12 font-medium">Reactor</th>
                <th className="py-8 pr-12 font-medium">Operator</th>
                <th className="py-8 pr-12 font-medium">Description</th>
                {!readOnly && (
                  <th className="py-8 font-medium text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr
                  key={incident.id}
                  className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-background-medium)]"
                >
                  <td className="py-8 pr-12 font-medium">
                    {formatDateTime(incident.incidentTime)}
                  </td>
                  <td className="py-8 pr-12">
                    {incident.severity ? formatProductionIncidentSeverity(incident.severity) : "\u2014"}
                  </td>
                  <td className="py-8 pr-12">{incident.reactorIdentifier ?? "\u2014"}</td>
                  <td className="py-8 pr-12">{incident.operatorName ?? "\u2014"}</td>
                  <td className="py-8 pr-12 max-w-[360px] whitespace-normal">
                    {incident.description}
                  </td>
                  {!readOnly && (
                    <td className="py-8 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Button
                          variant="noOutline"
                          size="icon"
                          onClick={() => openEdit(incident)}
                          aria-label="Edit incident"
                          disabled={formDialog.open}
                        >
                          <PencilIcon size={16} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => setDeletingId(incident.id)}
                          aria-label="Delete incident"
                          disabled={formDialog.open}
                        >
                          <TrashIcon size={16} />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!readOnly && (
        <QuickAddDialogShell
          isOpen={formDialog.open}
          onClose={closeDialog}
          title={
            formDialog.open && formDialog.incident
              ? "Edit Production Incident"
              : "Add Production Incident"
          }
          width="lg"
          testId="production-incident-dialog"
        >
          {formDialog.open && (
            <ProductionIncidentForm
              key={formDialog.incident?.id ?? "create"}
              productionRunId={productionRunId}
              facilityId={facilityId}
              defaultReactorId={defaultReactorId}
              defaultOperatorId={defaultOperatorId}
              incident={formDialog.incident}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
              isSubmitting={isSubmitting}
              errorMessage={formError ?? undefined}
            />
          )}
        </QuickAddDialogShell>
      )}

      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={!!deletingId}
          title="Delete Production Incident"
          message="Are you sure you want to delete this incident? This action cannot be undone."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingId(null)}
          isPending={deleteIncident.isPending}
        />
      )}
    </div>
  );
}
