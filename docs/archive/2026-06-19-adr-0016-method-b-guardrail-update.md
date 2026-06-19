# ADR 0016 Method-B Guardrail Update

Archived implementation context for the P0-03 checklist row.

ADR 0016 moved the sampling regime off `reactors` and onto
`production_processes`. During Phase 1, Dark Earth Carbon remains Method A
everywhere, so `reactors.sampling_method` and the migration-`0052`
reactor-grain Method-B trigger were removed in migration `0057`.

The process-grain Method-B guardrail is deferred to ADR 0017 with the
super-admin unlock. That future trigger should count samples for the production
process since `established_at`; the live cadence and unsampled-estimate logic
should also move from run/reactor grain to credit-batch/process grain.
