"use client";

import { useOpenSnapshot } from "@/hooks/use-open-snapshot";
import { usePickerEditSubmit } from "@/hooks/use-picker-edit-submit";
import type { EntityEditRecords } from "@/hooks/use-entity-edit-record";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import { CustomerForm } from "@/components/customers/customer-form";
import { useUpdateCustomer } from "@/hooks/use-customers";
import type { CustomerFormData } from "@/schemas/customers";
import { ReactorForm } from "@/components/reactors/reactor-form";
import { useUpdateReactor } from "@/hooks/use-reactors";
import type { CreateReactorData } from "@/schemas/reactors";
import { OrderForm } from "@/components/orders/order-form";
import { useUpdateOrder } from "@/hooks/use-orders";
import type { OrderFormData } from "@/schemas/orders";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { useUpdateSupplier } from "@/hooks/use-suppliers";
import type { SupplierFormData } from "@/schemas/suppliers";
import { FormulationForm } from "@/components/formulations/formulation-form";
import { useUpdateFormulation } from "@/hooks/use-formulations";
import type { FormulationFormData } from "@/schemas/formulations";
import { FeedstockTypeForm } from "@/components/feedstock-types/feedstock-type-form";
import { useUpdateFeedstockType } from "@/hooks/use-feedstock-types";
import type { FeedstockTypeFormData } from "@/schemas/feedstock-types";

interface EditProps<K extends keyof EntityEditRecords> {
  record: EntityEditRecords[K];
  isOpen: boolean;
  onClose: () => void;
}

export function CustomerEditFormDialog({ record: incoming, isOpen, onClose }: EditProps<"customer">) {
  const { snapshot, sessionKey } = useOpenSnapshot(isOpen, incoming);
  const record = snapshot ?? incoming;
  const update = useUpdateCustomer();
  const { error, handleSubmit, resetError } = usePickerEditSubmit<CustomerFormData>(
    (data) => update.mutateAsync({ ...data, customerId: record.id, expectedVersion: record.version }),
    onClose,
  );
  return (
    <QuickAddDialogShell isOpen={isOpen} onClose={onClose} onOpen={resetError} title="Edit customer"
      testId="customer-edit-dialog" dismissible={!update.isPending}>
      <CustomerForm key={sessionKey} customer={record} customerId={record.id}
        onSubmit={handleSubmit} onCancel={onClose} isSubmitting={update.isPending}
        errorMessage={error} submitLabel="Save changes" />
    </QuickAddDialogShell>
  );
}

export function ReactorEditFormDialog({ record: incoming, isOpen, onClose }: EditProps<"reactor">) {
  const { snapshot, sessionKey } = useOpenSnapshot(isOpen, incoming);
  const record = snapshot ?? incoming;
  const update = useUpdateReactor();
  const { error, handleSubmit, resetError } = usePickerEditSubmit<CreateReactorData>(
    (data) => update.mutateAsync({ ...data, reactorId: record.id, expectedVersion: record.version }),
    onClose,
  );
  return (
    <QuickAddDialogShell isOpen={isOpen} onClose={onClose} onOpen={resetError} title="Edit reactor"
      testId="reactor-edit-dialog" dismissible={!update.isPending}>
      <ReactorForm key={sessionKey} reactor={record}
        onSubmit={handleSubmit} onCancel={onClose} isSubmitting={update.isPending}
        errorMessage={error} submitLabel="Save changes" />
    </QuickAddDialogShell>
  );
}

export function OrderEditFormDialog({ record: incoming, isOpen, onClose }: EditProps<"order">) {
  const { snapshot, sessionKey } = useOpenSnapshot(isOpen, incoming);
  const record = snapshot ?? incoming;
  const update = useUpdateOrder();
  const { error, handleSubmit, resetError } = usePickerEditSubmit<OrderFormData>(
    (data) => update.mutateAsync({ ...data, orderId: record.id, expectedVersion: record.version }),
    onClose,
  );
  return (
    <QuickAddDialogShell isOpen={isOpen} onClose={onClose} onOpen={resetError} title="Edit order"
      testId="order-edit-dialog" dismissible={!update.isPending}>
      <OrderForm key={sessionKey} order={record}
        onSubmit={handleSubmit} onCancel={onClose} isSubmitting={update.isPending}
        errorMessage={error} submitLabel="Save changes" />
    </QuickAddDialogShell>
  );
}

export function SupplierEditFormDialog({ record: incoming, isOpen, onClose }: EditProps<"supplier">) {
  const { snapshot, sessionKey } = useOpenSnapshot(isOpen, incoming);
  const record = snapshot ?? incoming;
  const update = useUpdateSupplier();
  const { error, handleSubmit, resetError } = usePickerEditSubmit<SupplierFormData>(
    (data) => update.mutateAsync({ ...data, supplierId: record.id, expectedVersion: record.version }),
    onClose,
  );
  return (
    <QuickAddDialogShell isOpen={isOpen} onClose={onClose} onOpen={resetError} title="Edit supplier"
      testId="supplier-edit-dialog" dismissible={!update.isPending}>
      <SupplierForm key={sessionKey} supplier={record} supplierId={record.id}
        onSubmit={handleSubmit} onCancel={onClose} isSubmitting={update.isPending}
        errorMessage={error} submitLabel="Save changes" />
    </QuickAddDialogShell>
  );
}

export function FormulationEditFormDialog({ record: incoming, isOpen, onClose }: EditProps<"formulation">) {
  const { snapshot, sessionKey } = useOpenSnapshot(isOpen, incoming);
  const record = snapshot ?? incoming;
  const update = useUpdateFormulation();
  const { error, handleSubmit, resetError } = usePickerEditSubmit<FormulationFormData>(
    (data) => update.mutateAsync({ ...data, formulationId: record.id, expectedVersion: record.version }),
    onClose,
  );
  return (
    <QuickAddDialogShell isOpen={isOpen} onClose={onClose} onOpen={resetError} title="Edit formulation"
      testId="formulation-edit-dialog" dismissible={!update.isPending} width="lg">
      <FormulationForm key={sessionKey} formulation={record}
        onSubmit={handleSubmit} onCancel={onClose} isSubmitting={update.isPending}
        errorMessage={error} submitLabel="Save changes" />
    </QuickAddDialogShell>
  );
}

export function FeedstockTypeEditFormDialog({ record: incoming, isOpen, onClose }: EditProps<"feedstockType">) {
  const { snapshot, sessionKey } = useOpenSnapshot(isOpen, incoming);
  const record = snapshot ?? incoming;
  const update = useUpdateFeedstockType();
  const { error, handleSubmit, resetError } = usePickerEditSubmit<FeedstockTypeFormData>(
    (data) => update.mutateAsync({ ...data, feedstockTypeId: record.id, expectedVersion: record.version }),
    onClose,
  );
  return (
    <QuickAddDialogShell isOpen={isOpen} onClose={onClose} onOpen={resetError} title="Edit feedstock type"
      testId="feedstock-type-edit-dialog" dismissible={!update.isPending}>
      <FeedstockTypeForm key={sessionKey} feedstockType={record} stickyActions={false}
        onSubmit={handleSubmit} onCancel={onClose} isSubmitting={update.isPending}
        errorMessage={error} submitLabel="Save changes" />
    </QuickAddDialogShell>
  );
}
