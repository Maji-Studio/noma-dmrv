// Plain string-literal constants shared by certification orchestration and
// lib/isometric helpers. Keep them free of env and data-access imports so
// callers like `source-lock.ts` can use them without loading server modules.
export const ISOMETRIC_PROVIDER = "isometric" as const;
export const REMOVAL_SUBMISSION_TYPE = "removal" as const;
export const REMOVAL_SCOPED_SUBMISSION_TYPES = [REMOVAL_SUBMISSION_TYPE] as const;
// The Removal ledger row is keyed localEntityType='removal', localEntityId=
// certifierRemovals.id. N credit batches map into one removal.
export const REMOVAL_ENTITY_TYPE = "removal" as const;
// GHG-statement constants. A GHG Statement is an independent, period-anchored
// artifact (ADR 0003 / Phase 4.5); its ledger row is keyed
// (provider, 'ghg_statement', 'ghgStatement', certifierGhgStatements.id).
export const GHG_STATEMENT_SUBMISSION_TYPE = "ghg_statement" as const;
export const GHG_STATEMENT_ENTITY_TYPE = "ghgStatement" as const;
