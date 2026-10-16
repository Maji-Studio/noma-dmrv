"use client";

import type { ReactNode } from "react";
import type { ModalWidth } from "@/components/ui/modal";
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
import { RecordLockFormFrame } from "@/components/record-locks/record-lock-sheet-props";
import { useRecordLock } from "@/hooks/use-record-locks";
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

interface PickerEditFormDialogProps<R extends { id: string }, D> {
  record: R;
  isOpen: boolean;
  onClose: () => void;
  save: (data: D, record: R) => Promise<unknown>;
  isPending: boolean;
  title: string;
  testId: string;
  width?: ModalWidth;
  renderForm: (record: R, props: {
    key: string;
    onSubmit: (data: D) => Promise<void>;
    onCancel: () => void;
    isSubmitting: boolean;
    errorMessage?: string;
    submitLabel: string;
  }) => ReactNode;
}

function PickerEditFormDialog<R extends { id: string }, D>({
  record: incoming, isOpen, onClose, save, isPending, title, testId, width, renderForm,
}: PickerEditFormDialogProps<R, D>) {
  const { snapshot, sessionKey } = useOpenSnapshot(isOpen, incoming);
  const record = snapshot ?? incoming;
  const { error, handleSubmit, resetError } = usePickerEditSubmit<D>(
    (data) => save(data, record), onClose,
  );
  return (
    <QuickAddDialogShell isOpen={isOpen} onClose={onClose} onOpen={resetError}
      title={title} testId={testId} dismissible={!isPending} width={width}>
      {renderForm(record, {
        key: sessionKey, onSubmit: handleSubmit, onCancel: onClose,
        isSubmitting: isPending, errorMessage: error, submitLabel: "Save changes",
      })}
    </QuickAddDialogShell>
  );
}

export function CustomerEditFormDialog(props: EditProps<"customer">) {
  const update = useUpdateCustomer();
  return <PickerEditFormDialog {...props} title="Edit customer" testId="customer-edit-dialog"
    isPending={update.isPending}
    save={(data: CustomerFormData, record) => update.mutateAsync({ ...data, customerId: record.id, expectedVersion: record.version })}
    renderForm={(record, { key, ...formProps }) => <CustomerForm key={key} {...formProps} customer={record} customerId={record.id} />} />;
}

export function ReactorEditFormDialog(props: EditProps<"reactor">) {
  const update = useUpdateReactor();
  return <PickerEditFormDialog {...props} title="Edit reactor" testId="reactor-edit-dialog"
    isPending={update.isPending}
    save={(data: CreateReactorData, record) => update.mutateAsync({ ...data, reactorId: record.id, expectedVersion: record.version })}
    renderForm={(record, { key, ...formProps }) => <ReactorForm key={key} {...formProps} reactor={record} />} />;
}

export function OrderEditFormDialog(props: EditProps<"order">) {
  const update = useUpdateOrder();
  // The same lock as the order sheet: held fields disabled, Save off until it answers.
  const { lock, status } = useRecordLock("order", props.isOpen ? props.record.id : null);
  return <PickerEditFormDialog {...props} title="Edit order" testId="order-edit-dialog"
    isPending={update.isPending}
    save={(data: OrderFormData, record) => update.mutateAsync({ ...data, orderId: record.id, expectedVersion: record.version })}
    renderForm={(record, { key, ...formProps }) => (
      <RecordLockFormFrame lock={lock} status={status}>
        <OrderForm key={key} {...formProps} order={record} lock={lock} />
      </RecordLockFormFrame>
    )} />;
}

export function SupplierEditFormDialog(props: EditProps<"supplier">) {
  const update = useUpdateSupplier();
  return <PickerEditFormDialog {...props} title="Edit supplier" testId="supplier-edit-dialog"
    isPending={update.isPending}
    save={(data: SupplierFormData, record) => update.mutateAsync({ ...data, supplierId: record.id, expectedVersion: record.version })}
    renderForm={(record, { key, ...formProps }) => <SupplierForm key={key} {...formProps} supplier={record} supplierId={record.id} />} />;
}

export function FormulationEditFormDialog(props: EditProps<"formulation">) {
  const update = useUpdateFormulation();
  return <PickerEditFormDialog {...props} title="Edit formulation" testId="formulation-edit-dialog" width="lg"
    isPending={update.isPending}
    save={(data: FormulationFormData, record) => update.mutateAsync({ ...data, formulationId: record.id, expectedVersion: record.version })}
    renderForm={(record, { key, ...formProps }) => <FormulationForm key={key} {...formProps} formulation={record} />} />;
}

export function FeedstockTypeEditFormDialog(props: EditProps<"feedstockType">) {
  const update = useUpdateFeedstockType();
  return <PickerEditFormDialog {...props} title="Edit feedstock type" testId="feedstock-type-edit-dialog"
    isPending={update.isPending}
    save={(data: FeedstockTypeFormData, record) => update.mutateAsync({ ...data, feedstockTypeId: record.id, expectedVersion: record.version })}
    renderForm={(record, { key, ...formProps }) => <FeedstockTypeForm key={key} {...formProps} feedstockType={record} stickyActions={false} guardDialogCancel />} />;
}
