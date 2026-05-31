// Plain string-literal constants shared between the server-only fn/ layer
// and the lower-level lib/isometric/utils helpers. Lives here (rather than
// in `src/fn/certification/shared.ts`) so non-server callers like
// `source-lock.ts` can reference them without pulling env / data-access
// modules through a `"use server"` boundary.
export const ISOMETRIC_PROVIDER = "isometric" as const;
export const REMOVAL_SUBMISSION_TYPE = "removal" as const;
// The Removal ledger row is keyed localEntityType='removal', localEntityId=
// certifierRemovals.id. N credit batches map into one removal.
export const REMOVAL_ENTITY_TYPE = "removal" as const;
// GHG-statement constants. A GHG Statement is an independent, period-anchored
// artifact (ADR 0003 / Phase 4.5); its ledger row is keyed
// (provider, 'ghg_statement', 'ghgStatement', certifierGhgStatements.id).
export const GHG_STATEMENT_SUBMISSION_TYPE = "ghg_statement" as const;
export const GHG_STATEMENT_ENTITY_TYPE = "ghgStatement" as const;
