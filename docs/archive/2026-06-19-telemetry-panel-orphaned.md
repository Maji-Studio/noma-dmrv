# Certify-removal redesign — TelemetryPanel orphaned

Archived from `docs/open-questions.md` to keep the open-questions index concise.

Opened: 2026-06-19
Tracking key: `certification/telemetry-panel-orphaned`

The 2026-06-04 redesign deleted
`components/certification/removal-review/evidence-step.tsx`, which rendered
both `<SourcesPanel>` and `<TelemetryPanel>`. `SourcesPanel` was re-homed into
`removal-detail-sheet.tsx` in the transport-leg evidence PR on 2026-06-19 so
document evidence reaches the registry again. `TelemetryPanel` was intentionally
left out to keep that PR scoped to transport-leg evidence.

`TelemetryPanel` is still defined
(`components/certification/telemetry-panel.tsx`) with intact hooks
(`hooks/use-telemetry-submission.ts`), but it is not barrel-exported and not
rendered anywhere. The reactor temperature/pressure -> Isometric
`DataUploadSubmission` path (ADR 0006, Phase 5 Slice A) is unreachable from the
UI. It is dark, not removed.

Why it matters: operators cannot publish reactor telemetry to the registry from
the app. This is distinct from Sources because telemetry is a numeric sensor
stream, while Sources are evidence documents.

Resolve via: re-home `TelemetryPanel`; the removal-detail sheet alongside
`SourcesPanel` is the natural parity choice, and the panel's own doc comment
already says "Removal detail page". Re-export it from
`components/certification/index.ts`, then validate the
`POST /file-uploads -> PUT -> POST /data-upload-submissions` pipeline live on the
sandbox before re-surfacing it.
