"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  useDeleteTransportLeg,
  useTransportLegsForEntity,
} from "@/hooks/use-transport-legs";
import { formatMass } from "@/lib/format-utils";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import type { TransportLeg } from "@/db/schema";
import { TransportLegForm } from "./transport-leg-form";

interface TransportLegsPanelProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the section title. Defaults based on entityType. */
  title?: string;
}

const DEFAULT_TITLES: Record<TransportEntityTypeValue, string> = {
  feedstock: "Transport: feedstock → processing",
  biochar: "Transport: biochar → storage",
  sample: "Transport: sample → lab",
  delivery: "Transport legs",
};

export function TransportLegsPanel({
  entityType,
  entityId,
  title,
}: TransportLegsPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: legs, isLoading, error } = useTransportLegsForEntity(
    entityType,
    entityId,
  );
  const deleteMutation = useDeleteTransportLeg(entityType, entityId);
  const toast = useToast();

  const [formState, setFormState] = useState<
    { mode: "create" } | { mode: "edit"; leg: TransportLeg } | null
  >(() => {
    const intent = searchParams.get("transportLeg");
    return intent === "create" || intent === "add" ? { mode: "create" } : null;
  });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const intent = searchParams.get("transportLeg");
    const shouldCreate = intent === "create" || intent === "add";
    const shouldEdit = intent === "edit";
    if (!shouldCreate && !shouldEdit) return;

    if (shouldCreate) {
      queueMicrotask(() => setFormState({ mode: "create" }));
    } else {
      const legId = searchParams.get("transportLegId");
      if (!legId) return;
      if (!legs) return;

      const leg = legs.find((candidate) => candidate.id === legId);
      if (leg) {
        queueMicrotask(() => setFormState({ mode: "edit", leg }));
      }
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("transportLeg");
    nextParams.delete("transportLegId");
    const nextQuery = nextParams.toString();

    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [legs, pathname, router, searchParams]);

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      await deleteMutation.mutateAsync({ id: deletingId });
      toast.success("Transport leg deleted");
      setDeletingId(null);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete transport leg",
      );
    }
  };

  return (
    <section className="flex flex-col gap-12 border border-[var(--color-border-secondary)] p-16">
      <header className="flex items-center justify-between">
        <h3 className="title-heading-3">{title ?? DEFAULT_TITLES[entityType]}</h3>
        <Button
          variant="default"
          size="small"
          onClick={() => setFormState({ mode: "create" })}
        >
          Add leg
        </Button>
      </header>

      {error && (
        <ServerError
          message={
            error instanceof Error
              ? error.message
              : "Failed to load transport legs"
          }
        />
      )}

      {isLoading ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          Loading transport legs…
        </p>
      ) : !legs || legs.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          No transport legs recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-8">
          {legs.map((leg) => (
            <li
              key={leg.id}
              className="flex items-start justify-between gap-12 border border-[var(--color-border-secondary)] p-12"
            >
              <div className="flex flex-col gap-4">
                <div className="body-medium">
                  {leg.originName ?? "—"} → {leg.destinationName ?? "—"}
                </div>
                <div className="body-small text-[var(--color-text-secondary)]">
                  {leg.distanceKm} km ·{" "}
                  {leg.transportMethodType.replace(/_/g, " ")} ·{" "}
                  {leg.calculationMethodType.replace(/_/g, " ")}
                  {leg.transportEmissionsCo2eKg != null && (
                    <>
                      {" "}
                      · {leg.transportEmissionsCo2eKg.toLocaleString()} kg CO₂e
                    </>
                  )}
                </div>
                {leg.loadMassKg != null && (
                  <div className="body-small text-[var(--color-text-secondary)]">
                    Load: {formatMass(leg.loadMassKg)}
                  </div>
                )}
              </div>
              <div className="flex gap-8">
                <Button
                  variant="weak"
                  size="small"
                  onClick={() => setFormState({ mode: "edit", leg })}
                >
                  Edit
                </Button>
                <Button
                  variant="weak"
                  size="small"
                  onClick={() => setDeletingId(leg.id)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deleteError && <ServerError message={deleteError} />}

      {formState && (
        <TransportLegForm
          isOpen={true}
          onClose={() => setFormState(null)}
          entityType={entityType}
          entityId={entityId}
          leg={formState.mode === "edit" ? formState.leg : null}
        />
      )}

      <DeleteConfirmDialog
        isOpen={!!deletingId}
        title="Delete transport leg"
        message="This transport leg will be permanently removed. This cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeletingId(null);
          setDeleteError(null);
        }}
        isPending={deleteMutation.isPending}
      />
    </section>
  );
}
