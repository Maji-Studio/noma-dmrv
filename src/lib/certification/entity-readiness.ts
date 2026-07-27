import {
  getCertifyFieldDescriptors,
  type CertifyEntityKind,
  type CertifyFieldDescriptor,
} from "./certify-field-registry";
import { hasCompleteTransportEvidence } from "./transport-evidence";

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

const TERMINAL_STATUS_BY_ENTITY: Partial<Record<CertifyEntityKind, string[]>> = {
  productionRun: ["complete"],
  feedstock: ["complete"],
  delivery: ["delivered"],
};

const TELEMETRY_GAP: EntityCertifyGap = {
  kind: "field",
  key: "telemetryReadings",
  label: "Telemetry readings",
  fields: ["readingsCount"],
  detail: "Production readings CSV is required to certify",
};

const APPLICATION_EVIDENCE_GAP: EntityCertifyGap = {
  kind: "field",
  key: "applicationEvidence",
  label: "Application evidence",
  fields: ["evidenceGapCount"],
  detail: "Geotagged photos or boundary evidence required to certify",
};

const TRANSPORT_EVIDENCE_GAP: EntityCertifyGap = {
  kind: "field",
  key: "transportEvidence",
  label: "Transport evidence",
  fields: ["transportEvidenceDocumentCount"],
  detail:
    "At least one accepted, classified transport-evidence file is required to certify",
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

function fieldGap(descriptor: CertifyFieldDescriptor): EntityCertifyGap {
  const fields =
    descriptor.satisfaction?.mode === "anyOf" ||
    descriptor.satisfaction?.mode === "allOf"
      ? descriptor.satisfaction.fields
      : descriptor.satisfaction?.mode === "equals"
        ? [descriptor.satisfaction.field]
        : descriptorFields(descriptor);
  const requirement =
    descriptor.condition != null
      ? `${descriptor.label} is required for ${descriptor.condition.label}`
      : `${descriptor.label} is required to certify`;

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
    detail: `Status must be ${terminalStates.join(" or ")} to certify`,
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
  // output, telemetry, or document gaps would send operators to fill data that
  // cannot make these outcomes certifiable.
  if (
    entityKind === "productionRun" &&
    (effectiveLifecycleState === "failed" || effectiveLifecycleState === "cancelled")
  ) {
    return { state: "incomplete", gaps, warnings };
  }

  if (entityKind === "productionRun") {
    const readingsCount = fieldValue(entity, "readingsCount");
    if (
      typeof readingsCount !== "number" ||
      !Number.isFinite(readingsCount) ||
      readingsCount <= 0
    ) {
      gaps.push(TELEMETRY_GAP);
    }
  }

  if (entityKind === "application") {
    const evidenceGapCount = fieldValue(entity, "evidenceGapCount");
    if (
      typeof evidenceGapCount !== "number" ||
      !Number.isFinite(evidenceGapCount) ||
      evidenceGapCount !== 0
    ) {
      gaps.push(APPLICATION_EVIDENCE_GAP);
    }
  }

  if (entityKind === "feedstock" || entityKind === "delivery") {
    const documentCount = fieldValue(
      entity,
      "transportEvidenceDocumentCount",
    );
    if (
      !hasCompleteTransportEvidence(
        typeof documentCount === "number" ? documentCount : undefined,
      )
    ) {
      gaps.push(TRANSPORT_EVIDENCE_GAP);
    }
  }

  // Callers load legs via `getTransportLegsWithEvidenceForEntities` so the
  // accepted-file count is normally present. A missing count must fail closed
  // because evidence coverage and Source-binding readiness are independent of
  // how the distance itself was established.
  if (entityKind === "transportLeg") {
    const documentCount = fieldValue(
      entity,
      "transportEvidenceDocumentCount",
    );
    if (
      !hasCompleteTransportEvidence(
        typeof documentCount === "number" ? documentCount : undefined,
      )
    ) {
      gaps.push(TRANSPORT_EVIDENCE_GAP);
    }
  }

  for (const descriptor of getCertifyFieldDescriptors(entityKind)) {
    if (!conditionApplies(descriptor, entity)) continue;
    if (descriptorSatisfied(descriptor, entity)) continue;
    gaps.push(fieldGap(descriptor));
  }

  return {
    state: gaps.length === 0 ? "ready" : "incomplete",
    gaps,
    warnings,
  };
}
