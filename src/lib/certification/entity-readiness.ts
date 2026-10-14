import {
  getCertifyFieldDescriptors,
  type CertifyEntityKind,
  type CertifyFieldDescriptor,
} from "./certify-field-registry";

export type EntityCertifyReadinessState = "ready" | "incomplete";

export type EntityCertifyGapKind = "lifecycle" | "field";

export interface EntityCertifyGap {
  kind: EntityCertifyGapKind;
  key: string;
  label: string;
  fields: readonly string[];
  detail: string;
}

export interface EntityCertifyReadiness {
  state: EntityCertifyReadinessState;
  gaps: EntityCertifyGap[];
  warnings: EntityCertifyWarning[];
}

export type EntityCertifyWarning = Omit<EntityCertifyGap, "kind">;

export type EntityReadinessRecord = object;

export const REMOVAL_FIELD_CHECK_SCOPE =
  "Fields complete checks this record's own fields. Removal submission also checks production runs, Samples, transport legs, delivery distances and the order’s customer location.";

const TERMINAL_STATUS_BY_ENTITY: Partial<Record<CertifyEntityKind, string[]>> = {
  productionRun: ["complete"],
  feedstock: ["complete"],
  delivery: ["delivered"],
};

const LIFECYCLE_DETAIL_BY_ENTITY: Partial<Record<CertifyEntityKind, string>> = {
  feedstock: "Complete the feedstock material record",
  delivery: "Set status to delivered for transport accounting",
};

const FIELD_PURPOSE_BY_ENTITY: Partial<Record<CertifyEntityKind, string>> = {
  feedstock: "feedstock transport calculations",
  delivery: "biochar transport calculations",
  application: "applied biochar accounting",
  supplier: "the default feedstock transport distance",
  supplierLocation: "the default feedstock transport distance",
  customerLocation: "the default delivery transport distance",
};

function fieldValue(
  entity: EntityReadinessRecord,
  field: string,
): unknown {
  return (entity as Record<string, unknown>)[field];
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function conditionApplies(
  descriptor: CertifyFieldDescriptor,
  entity: EntityReadinessRecord,
): boolean {
  if (!descriptor.condition) return true;
  if ("allOf" in descriptor.condition) {
    return descriptor.condition.allOf.every(
      (condition) =>
        fieldValue(entity, condition.field) === condition.equals,
    );
  }
  return (
    fieldValue(entity, descriptor.condition.field) === descriptor.condition.equals
  );
}

function descriptorFields(descriptor: CertifyFieldDescriptor): readonly string[] {
  return descriptor.formFields ?? [descriptor.key];
}

function descriptorSatisfied(
  descriptor: CertifyFieldDescriptor,
  entity: EntityReadinessRecord,
): boolean {
  if (descriptor.satisfaction?.mode === "allOf") {
    return descriptor.satisfaction.fields.every((field) =>
      isPresent(fieldValue(entity, field)),
    );
  }

  if (descriptor.satisfaction?.mode === "anyOf") {
    return descriptor.satisfaction.fields.some((field) =>
      isPresent(fieldValue(entity, field)),
    );
  }

  if (descriptor.satisfaction?.mode === "equals") {
    return (
      fieldValue(entity, descriptor.satisfaction.field) ===
      descriptor.satisfaction.value
    );
  }

  if (descriptor.kind === "derived") return true;

  return descriptorFields(descriptor).every((field) =>
    isPresent(fieldValue(entity, field)),
  );
}

function fieldGap(
  descriptor: CertifyFieldDescriptor,
  entityKind: CertifyEntityKind,
): EntityCertifyGap {
  const fields =
    descriptor.satisfaction?.mode === "anyOf" ||
    descriptor.satisfaction?.mode === "allOf"
      ? descriptor.satisfaction.fields
      : descriptor.satisfaction?.mode === "equals"
        ? [descriptor.satisfaction.field]
        : descriptorFields(descriptor);
  const requirement = descriptor.gapDetail ?? (FIELD_PURPOSE_BY_ENTITY[entityKind]
    ? `Record ${descriptor.label.toLowerCase()} for ${FIELD_PURPOSE_BY_ENTITY[entityKind]}`
    : descriptor.condition != null
      ? `${descriptor.label} is required for ${descriptor.condition.label}`
      : `${descriptor.label} is required to certify`);

  return {
    kind: "field",
    key: descriptor.key,
    label: descriptor.label,
    fields,
    detail: requirement,
  };
}

function lifecycleGap(
  entityKind: CertifyEntityKind,
  lifecycleState: string | null | undefined,
): EntityCertifyGap | null {
  const terminalStates = TERMINAL_STATUS_BY_ENTITY[entityKind];
  if (!terminalStates) return null;
  if (lifecycleState != null && terminalStates.includes(lifecycleState)) {
    return null;
  }

  return {
    kind: "lifecycle",
    key: "lifecycleState",
    label: "Lifecycle state",
    fields: ["status"],
    detail: LIFECYCLE_DETAIL_BY_ENTITY[entityKind] ??
      `Status must be ${terminalStates.join(" or ")} to certify`,
  };
}

export function deriveEntityCertifyReadiness(
  entityKind: CertifyEntityKind,
  entity: EntityReadinessRecord,
  lifecycleState?: string | null,
): EntityCertifyReadiness {
  const gaps: EntityCertifyGap[] = [];
  const warnings: EntityCertifyWarning[] = [];
  const effectiveLifecycleState =
    lifecycleState ?? (fieldValue(entity, "status") as string | null | undefined);

  const lifecycle = lifecycleGap(entityKind, effectiveLifecycleState);
  if (lifecycle) gaps.push(lifecycle);

  // Failed and cancelled runs are audit records, not certification candidates.
  // Their lifecycle state is the only actionable certification gap; surfacing
  // output or document gaps would send operators to fill data that
  // cannot make these outcomes certifiable.
  if (
    entityKind === "productionRun" &&
    (effectiveLifecycleState === "failed" || effectiveLifecycleState === "cancelled")
  ) {
    return { state: "incomplete", gaps, warnings };
  }

  for (const descriptor of getCertifyFieldDescriptors(entityKind)) {
    if (!conditionApplies(descriptor, entity)) continue;
    if (descriptorSatisfied(descriptor, entity)) continue;
    if (descriptor.advisory) {
      warnings.push({ ...fieldGap(descriptor, entityKind), detail: descriptor.advisory });
    } else {
      gaps.push(fieldGap(descriptor, entityKind));
    }
  }

  return {
    state: gaps.length === 0 ? "ready" : "incomplete",
    gaps,
    warnings,
  };
}
