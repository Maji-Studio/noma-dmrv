"use client";

import { useEffect, useRef, useState } from "react";
import { useEntityEditRecord, type EditableEntityType, type EntityEditRecords } from "@/hooks/use-entity-edit-record";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { Notice } from "@/components/ui/notice";
import { DetailSpine } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { ServerError } from "../server-error";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import { ENTITY_TYPE_LABELS } from "./entity-labels";
import { VehicleQuickAddDialog } from "./vehicle-quick-add-dialog";
import { DriverQuickAddDialog } from "./driver-quick-add-dialog";
import { OperatorQuickAddDialog } from "./operator-quick-add-dialog";
import { StorageLocationQuickAddDialog } from "./storage-location-quick-add-dialog";
import { FormulationQuickAddDialog } from "./formulation-quick-add-dialog";
import { FeedstockTypeQuickAddDialog } from "./feedstock-type-quick-add-dialog";
import { SupplierQuickAddDialog } from "./supplier-quick-add-dialog";
import { CustomerEditFormDialog, ReactorEditFormDialog, OrderEditFormDialog } from "./entity-edit-forms";

export interface EntityEditDialogProps {
  entityType: EditableEntityType;
  entityId: string | null | undefined;
  isOpen: boolean;
  onClose: () => void;
}

const ignoreCreated = () => undefined;

/** A closed dialog has no observer or draft. Every open starts a fresh read. */
export function EntityEditDialog({ entityType, entityId, isOpen, onClose }: EntityEditDialogProps) {
  if (!isOpen || !entityId) return null;
  return <EntityEditSession key={`${entityType}:${entityId}`} entityType={entityType} entityId={entityId} onClose={onClose} />;
}

function EntityEditSession({ entityType, entityId, onClose }: {
  entityType: EditableEntityType;
  entityId: string;
  onClose: () => void;
}) {
  const query = useEntityEditRecord(entityType, entityId);
  const [record, setRecord] = useState<EntityEditRecords[EditableEntityType] | null>(null);
  const toast = useToast();
  const notifiedFailure = useRef(false);
  const message = `The ${ENTITY_TYPE_LABELS[entityType]} could not be loaded. Try again.`;
  // A toast is an external notification; only report a settled opening failure.
  useEffect(() => {
    if (query.isError && !record && !notifiedFailure.current) {
      notifiedFailure.current = true;
      toast.error(message);
    }
    if (!query.isError) notifiedFailure.current = false;
  }, [query.isError, record, toast, message]);

  if (!record && query.isFetchedAfterMount && !query.isFetching && query.isSuccess) {
    setRecord(query.data);
  }

  if (!record) return (
    <QuickAddDialogShell isOpen onClose={onClose} title={`Edit ${ENTITY_TYPE_LABELS[entityType]}`} testId={`${entityType}-edit-dialog-loading`}>
      {query.isError ? <ServerError message={message} action={<Button size="small" onClick={() => void query.refetch()}>Try again</Button>} /> : <Skeleton className="h-320 w-full" />}
    </QuickAddDialogShell>
  );

  // Bins keep their existing full read-only presentation.
  if (entityType !== "storageLocation" && "archivedAt" in record && record.archivedAt != null) {
    return (
      <QuickAddDialogShell isOpen onClose={onClose} title={`View ${ENTITY_TYPE_LABELS[entityType]}`}
        testId={entityType === "feedstockType" ? "feedstock-type-edit-dialog" : `${entityType}-edit-dialog`}>
        <div className="space-y-20">
          <Notice tone="info">This {ENTITY_TYPE_LABELS[entityType]} is archived and read-only.</Notice>
          <DetailSpine sections={[{ title: "Details", fields: [
            ...("code" in record ? [{ label: "Code", value: record.code }] : []),
            ...("name" in record ? [{ label: "Name", value: record.name }] : []),
            ...("identifier" in record ? [{ label: "Identifier", value: record.identifier }] : []),
          ] }]} />
        </div>
      </QuickAddDialogShell>
    );
  }

  const props = { isOpen: true, onClose, onSuccess: ignoreCreated };
  switch (entityType) {
    case "vehicle": return <VehicleQuickAddDialog {...props} vehicle={record as EntityEditRecords["vehicle"]} />;
    case "driver": return <DriverQuickAddDialog {...props} driver={record as EntityEditRecords["driver"]} />;
    case "operator": return <OperatorQuickAddDialog {...props} operator={record as EntityEditRecords["operator"]} />;
    case "storageLocation": {
      const bin = record as EntityEditRecords["storageLocation"];
      return <StorageLocationQuickAddDialog {...props} storageLocation={bin} facilityId={bin.facilityId} />;
    }
    case "formulation": return <FormulationQuickAddDialog {...props} formulation={record as EntityEditRecords["formulation"]} />;
    case "supplier": return <SupplierQuickAddDialog {...props} supplier={record as EntityEditRecords["supplier"]} />;
    case "feedstockType": return <FeedstockTypeQuickAddDialog {...props} feedstockType={record as EntityEditRecords["feedstockType"]} />;
    case "customer": return <CustomerEditFormDialog {...props} record={record as EntityEditRecords["customer"]} />;
    case "reactor": return <ReactorEditFormDialog {...props} record={record as EntityEditRecords["reactor"]} />;
    case "order": return <OrderEditFormDialog {...props} record={record as EntityEditRecords["order"]} />;
  }
}
