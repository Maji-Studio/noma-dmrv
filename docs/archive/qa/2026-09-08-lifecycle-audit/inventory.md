# Route and action inventory

This is the complete page/handler inventory at staging `ef857545b11fa298f0f08e128868ed14e37fbf5f`, generated before delegation. Use it with the coverage matrix and investigator reports. Inventory is not a claim of live browser testing.

## All 54 page and handler routes

| Route | Investigator | Entry file | Direct feature imports or redirect |
|---|---|---|---|
| `/admin/organizations` | Parent | [page.tsx](../../../../src/app/(app)/admin/organizations/page.tsx) | @/components/ui, @/components/organizations/organizations-admin |
| `/admin` | Parent | [page.tsx](../../../../src/app/(app)/admin/page.tsx) | "/admin/organizations") |
| `/admin/users` | Parent | [page.tsx](../../../../src/app/(app)/admin/users/page.tsx) | "/settings/organization") |
| `/applications` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/applications/page.tsx) | @/components/applications |
| `/biochar-products` | Production | [page.tsx](../../../../src/app/(app)/biochar-products/page.tsx) | @/components/biochar-products |
| `/certification/ghg-statements` | Registry | [page.tsx](../../../../src/app/(app)/certification/ghg-statements/page.tsx) | @/components/certification/ghg-statements-list |
| `/certification` | Registry | [page.tsx](../../../../src/app/(app)/certification/page.tsx) | @/lib/certification/links |
| `/certification/removals/[removalId]` | Registry | [page.tsx](../../../../src/app/(app)/certification/removals/[removalId]/page.tsx) |      facility ? `${base}&facility=${encodeURIComponent(facility)}` : base,   ) |
| `/certification/removals/[removalId]/review` | Registry | [page.tsx](../../../../src/app/(app)/certification/removals/[removalId]/review/page.tsx) |      facility ? `${base}&facility=${encodeURIComponent(facility)}` : base,   ) |
| `/certification/removals` | Registry | [page.tsx](../../../../src/app/(app)/certification/removals/page.tsx) | @/components/certification/removals-list |
| `/certification/settings` | Registry | [page.tsx](../../../../src/app/(app)/certification/settings/page.tsx) | @/components/certification |
| `/chain-of-custody` | Parent | [page.tsx](../../../../src/app/(app)/chain-of-custody/page.tsx) | query ? `/traceability?${query}` : "/traceability") |
| `/credit-batches/[id]` | Production | [page.tsx](../../../../src/app/(app)/credit-batches/[id]/page.tsx) | @/data-access/credit-batches, @/lib/auth/server, @/lib/credit-batch-links |
| `/credit-batches` | Production | [page.tsx](../../../../src/app/(app)/credit-batches/page.tsx) | @/components/credit-batches, @/lib/create-intent, @/lib/auth/server |
| `/customers/[customerId]` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/customers/[customerId]/page.tsx) | @/components/customers, @/data-access/entities/customers, @/lib/auth/server |
| `/customers` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/customers/page.tsx) | @/components/customers |
| `/dashboard` | Parent | [page.tsx](../../../../src/app/(app)/dashboard/page.tsx) | @/components/dashboard |
| `/deliveries` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/deliveries/page.tsx) | @/components/deliveries |
| `/energy` | Production | [page.tsx](../../../../src/app/(app)/energy/page.tsx) | @/components/energy/energy-summary |
| `/facilities` | Parent | [page.tsx](../../../../src/app/(app)/facilities/page.tsx) | @/components/facilities |
| `/feedstock-types` | Parent | [page.tsx](../../../../src/app/(app)/feedstock-types/page.tsx) | @/components/feedstock-types, @/lib/auth/server |
| `/feedstocks` | Production | [page.tsx](../../../../src/app/(app)/feedstocks/page.tsx) | @/components/feedstocks |
| `/formulations` | Production | [page.tsx](../../../../src/app/(app)/formulations/page.tsx) | @/components/formulations |
| `/orders` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/orders/page.tsx) | @/components/orders |
| `/production-runs/[productionRunId]` | Production | [page.tsx](../../../../src/app/(app)/production-runs/[productionRunId]/page.tsx) | `/production-runs?${nextParams.toString()}`) |
| `/production-runs` | Production | [page.tsx](../../../../src/app/(app)/production-runs/page.tsx) | @/components/production-runs |
| `/reactors` | Parent | [page.tsx](../../../../src/app/(app)/reactors/page.tsx) | @/components/reactors |
| `/samples` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/samples/page.tsx) | @/components/samples, @/lib/sample-create-intent, @/lib/create-intent |
| `/settings/defaults` | Parent | [page.tsx](../../../../src/app/(app)/settings/defaults/page.tsx) | @/components/settings, @/fn/organizations, @/lib/auth/server |
| `/settings/organization` | Parent | [page.tsx](../../../../src/app/(app)/settings/organization/page.tsx) | @/components/organizations/organization-settings, @/components/settings, @/fn/organizations |
| `/settings` | Parent | [page.tsx](../../../../src/app/(app)/settings/page.tsx) | @/lib/settings/links |
| `/storage-locations` | Parent | [page.tsx](../../../../src/app/(app)/storage-locations/page.tsx) | @/components/storage-locations |
| `/suppliers/[supplierId]` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/suppliers/[supplierId]/page.tsx) | @/components/suppliers, @/data-access/entities/suppliers, @/lib/auth/server |
| `/suppliers` | Distribution/evidence | [page.tsx](../../../../src/app/(app)/suppliers/page.tsx) | @/components/suppliers |
| `/traceability` | Parent | [page.tsx](../../../../src/app/(app)/traceability/page.tsx) | @/components/chain-of-custody |
| `/accept-invitation/[id]` | Parent | [page.tsx](../../../../src/app/(auth)/accept-invitation/[id]/page.tsx) | @/lib/auth/server, @/components/organizations/accept-invitation, @/components/organizations/invitation-bootstrap-form |
| `/forgot-password` | Parent | [page.tsx](../../../../src/app/(auth)/forgot-password/page.tsx) | @/components/auth |
| `/login` | Parent | [page.tsx](../../../../src/app/(auth)/login/page.tsx) | @/components/auth |
| `/reset-password` | Parent | [page.tsx](../../../../src/app/(auth)/reset-password/page.tsx) | @/components/auth |
| `/set-password` | Parent | [page.tsx](../../../../src/app/(auth)/set-password/page.tsx) | @/components/auth |
| `/verify-email/callback` | Parent | [page.tsx](../../../../src/app/(auth)/verify-email/callback/page.tsx) | Inline route implementation |
| `/verify-email` | Parent | [page.tsx](../../../../src/app/(auth)/verify-email/page.tsx) | @/lib/auth/client, @/components/ui/button |
| `/api/auth/[...all]` | Parent | [route.ts](../../../../src/app/api/auth/[...all]/route.ts) | @/lib/auth/better-auth |
| `/api/certification/submissions` | Registry | [route.ts](../../../../src/app/api/certification/submissions/route.ts) | @/lib/auth/server, @/lib/errors, @/lib/rate-limit/in-memory |
| `/api/documents/[id]` | Distribution/evidence | [route.ts](../../../../src/app/api/documents/[id]/route.ts) | @/data-access/documents, @/lib/auth/server, @/lib/storage |
| `/api/ghg-statement-reports/[reportId]` | Registry | [route.ts](../../../../src/app/api/ghg-statement-reports/[reportId]/route.ts) | @/data-access/ghg-statement-reports, @/lib/certification/ghg-statement-report/verifier-url, @/lib/storage |
| `/api/storage-local/[...key]` | Parent | [route.ts](../../../../src/app/api/storage-local/[...key]/route.ts) | @/config/env, @/lib/storage/local-fs |
| `/auth/signout` | Parent | [route.ts](../../../../src/app/auth/signout/route.ts) | @/lib/auth/server |
| `/` | Parent | [page.tsx](../../../../src/app/page.tsx) | @/components/ui |
| `/schema/[table]` | Parent | [page.tsx](../../../../src/app/schema/[table]/page.tsx) | @/components/ui/button, @/lib/copy-utils, @/lib/schema/catalog |
| `/schema/links` | Parent | [page.tsx](../../../../src/app/schema/links/page.tsx) | @/components/ui/button, @/lib/schema/catalog |
| `/schema` | Parent | [page.tsx](../../../../src/app/schema/page.tsx) | @/components/schema/schema-table-view, @/lib/schema/catalog |
| `/styleguide` | Parent | [page.tsx](../../../../src/app/styleguide/page.tsx) | Inline route implementation |
| `/unauthorized` | Parent | [page.tsx](../../../../src/app/unauthorized/page.tsx) | Inline route implementation |

## All 280 exported async server actions

Includes reads and helpers as well as mutations. Related handler methods and Better Auth mutations are covered separately in the route table.

| Action | Implementation |
|---|---|
| `loadApplicationCertificationLock` | [src/fn/application-certification-lock.ts:6](../../../../src/fn/application-certification-lock.ts#L6) |
| `getApplicationsFn` | [src/fn/applications.ts:59](../../../../src/fn/applications.ts#L59) |
| `getApplicationDeliveryOptionsFn` | [src/fn/applications.ts:83](../../../../src/fn/applications.ts#L83) |
| `createApplicationFn` | [src/fn/applications.ts:112](../../../../src/fn/applications.ts#L112) |
| `updateApplicationFn` | [src/fn/applications.ts:151](../../../../src/fn/applications.ts#L151) |
| `deleteApplicationFn` | [src/fn/applications.ts:200](../../../../src/fn/applications.ts#L200) |
| `getBinMovementsFn` | [src/fn/bin-movements.ts:58](../../../../src/fn/bin-movements.ts#L58) |
| `recordStockTakeFn` | [src/fn/bin-movements.ts:81](../../../../src/fn/bin-movements.ts#L81) |
| `recordLossFn` | [src/fn/bin-movements.ts:124](../../../../src/fn/bin-movements.ts#L124) |
| `getBiocharProductsFn` | [src/fn/biochar-products.ts:58](../../../../src/fn/biochar-products.ts#L58) |
| `getBiocharProductByIdFn` | [src/fn/biochar-products.ts:94](../../../../src/fn/biochar-products.ts#L94) |
| `createBiocharProductFn` | [src/fn/biochar-products.ts:121](../../../../src/fn/biochar-products.ts#L121) |
| `updateBiocharProductFn` | [src/fn/biochar-products.ts:181](../../../../src/fn/biochar-products.ts#L181) |
| `deleteBiocharProductFn` | [src/fn/biochar-products.ts:230](../../../../src/fn/biochar-products.ts#L230) |
| `buildApplicationEvidenceGaps` | [src/fn/certification/application-evidence-readiness.ts:44](../../../../src/fn/certification/application-evidence-readiness.ts#L44) |
| `loadBatchHealth` | [src/fn/certification/batch-health.ts:17](../../../../src/fn/certification/batch-health.ts#L17) |
| `compileBiocharApplicationIntents` | [src/fn/certification/biochar-application-intents.ts:65](../../../../src/fn/certification/biochar-application-intents.ts#L65) |
| `ensureRemovalBiocharApplications` | [src/fn/certification/biochar-applications.ts:43](../../../../src/fn/certification/biochar-applications.ts#L43) |
| `resolveScopeForRemoval` | [src/fn/certification/certify-context-core.ts:340](../../../../src/fn/certification/certify-context-core.ts#L340) |
| `loadFacilityCertifierFacts` | [src/fn/certification/certify-context-core.ts:435](../../../../src/fn/certification/certify-context-core.ts#L435) |
| `buildRemovalContext` | [src/fn/certification/certify-context-core.ts:517](../../../../src/fn/certification/certify-context-core.ts#L517) |
| `loadRemovalSubmissionContext` | [src/fn/certification/certify-context-core.ts:786](../../../../src/fn/certification/certify-context-core.ts#L786) |
| `loadRemovalCertifyContext` | [src/fn/certification/certify-context-core.ts:838](../../../../src/fn/certification/certify-context-core.ts#L838) |
| `loadCertifyContextForCreditBatchForUser` | [src/fn/certification/certify-context-core.ts:854](../../../../src/fn/certification/certify-context-core.ts#L854) |
| `loadCertifyContextForCreditBatch` | [src/fn/certification/certify-context-core.ts:868](../../../../src/fn/certification/certify-context-core.ts#L868) |
| `buildCreditBatchContexts` | [src/fn/certification/certify-context-core.ts:882](../../../../src/fn/certification/certify-context-core.ts#L882) |
| `loadSelectableBatchesForFacility` | [src/fn/certification/certify-context-core.ts:929](../../../../src/fn/certification/certify-context-core.ts#L929) |
| `loadCertifyContextForCreditBatch` | [src/fn/certification/certify-context.ts:30](../../../../src/fn/certification/certify-context.ts#L30) |
| `loadRemovalCertifyContext` | [src/fn/certification/certify-context.ts:36](../../../../src/fn/certification/certify-context.ts#L36) |
| `loadRemovalsForFacility` | [src/fn/certification/certify-context.ts:43](../../../../src/fn/certification/certify-context.ts#L43) |
| `loadSelectableBatchesForFacility` | [src/fn/certification/certify-context.ts:49](../../../../src/fn/certification/certify-context.ts#L49) |
| `createRemovalWithBatchesAction` | [src/fn/certification/create-removal-with-batches.ts:30](../../../../src/fn/certification/create-removal-with-batches.ts#L30) |
| `deleteRemovalAction` | [src/fn/certification/delete-removal-action.ts:13](../../../../src/fn/certification/delete-removal-action.ts#L13) |
| `deleteRemoval` | [src/fn/certification/delete-removal.ts:89](../../../../src/fn/certification/delete-removal.ts#L89) |
| `loadCreditBatchDurabilitySummary` | [src/fn/certification/durability-batch-summary.ts:24](../../../../src/fn/certification/durability-batch-summary.ts#L24) |
| `ensureDurabilityEvidenceLedgerSourceFromContext` | [src/fn/certification/durability-evidence-ledger.ts:50](../../../../src/fn/certification/durability-evidence-ledger.ts#L50) |
| `patchMeasurementSampleSourceBindings` | [src/fn/certification/durability-measurement-samples.ts:268](../../../../src/fn/certification/durability-measurement-samples.ts#L268) |
| `submitDurabilityMeasurementSamples` | [src/fn/certification/durability-measurement-samples.ts:424](../../../../src/fn/certification/durability-measurement-samples.ts#L424) |
| `loadDurabilityBatchData` | [src/fn/certification/durability-readiness.ts:36](../../../../src/fn/certification/durability-readiness.ts#L36) |
| `ensureEvidenceLedgersFromContext` | [src/fn/certification/ensure-evidence-ledgers.ts:26](../../../../src/fn/certification/ensure-evidence-ledgers.ts#L26) |
| `ensureLedgerSource` | [src/fn/certification/evidence-ledger-core.ts:226](../../../../src/fn/certification/evidence-ledger-core.ts#L226) |
| `retireLedgerSources` | [src/fn/certification/evidence-ledger-core.ts:374](../../../../src/fn/certification/evidence-ledger-core.ts#L374) |
| `ensureTransportEvidenceLedgerSourceFromContext` | [src/fn/certification/evidence-ledger.ts:43](../../../../src/fn/certification/evidence-ledger.ts#L43) |
| `loadEvidenceMirrorSummaryForScope` | [src/fn/certification/evidence-mirror-summary.ts:62](../../../../src/fn/certification/evidence-mirror-summary.ts#L62) |
| `loadFacilityCertifierSummary` | [src/fn/certification/facility-mapping.ts:65](../../../../src/fn/certification/facility-mapping.ts#L65) |
| `loadFacilityCertifierMapping` | [src/fn/certification/facility-mapping.ts:94](../../../../src/fn/certification/facility-mapping.ts#L94) |
| `saveFacilityCertifierMapping` | [src/fn/certification/facility-mapping.ts:150](../../../../src/fn/certification/facility-mapping.ts#L150) |
| `deleteFacilityCertifierMapping` | [src/fn/certification/facility-mapping.ts:218](../../../../src/fn/certification/facility-mapping.ts#L218) |
| `loadIsometricProjectTemplates` | [src/fn/certification/facility-mapping.ts:227](../../../../src/fn/certification/facility-mapping.ts#L227) |
| `saveFacilityEmissionConfig` | [src/fn/certification/facility-mapping.ts:239](../../../../src/fn/certification/facility-mapping.ts#L239) |
| `loadIsometricFeedstockTypes` | [src/fn/certification/feedstock-types.ts:16](../../../../src/fn/certification/feedstock-types.ts#L16) |
| `loadGhgStatementBreakdown` | [src/fn/certification/ghg-statement-breakdown.ts:44](../../../../src/fn/certification/ghg-statement-breakdown.ts#L44) |
| `finalizeGhgStatement` | [src/fn/certification/ghg-statement-finalization.ts:29](../../../../src/fn/certification/ghg-statement-finalization.ts#L29) |
| `reconcileGhgStatementsForFacility` | [src/fn/certification/ghg-statement-reconciliation.ts:93](../../../../src/fn/certification/ghg-statement-reconciliation.ts#L93) |
| `listRegistryGhgStatementsForFacility` | [src/fn/certification/ghg-statement-reconciliation.ts:240](../../../../src/fn/certification/ghg-statement-reconciliation.ts#L240) |
| `reconcileRegistryGhgStatement` | [src/fn/certification/ghg-statement-reconciliation.ts:260](../../../../src/fn/certification/ghg-statement-reconciliation.ts#L260) |
| `reconcileRegistryGhgStatementById` | [src/fn/certification/ghg-statement-reconciliation.ts:398](../../../../src/fn/certification/ghg-statement-reconciliation.ts#L398) |
| `rebuildGhgStatementReportModel` | [src/fn/certification/ghg-statement-reports.ts:304](../../../../src/fn/certification/ghg-statement-reports.ts#L304) |
| `issueVerifierReportUrl` | [src/fn/certification/ghg-statement-reports.ts:330](../../../../src/fn/certification/ghg-statement-reports.ts#L330) |
| `assertGhgStatementReportFresh` | [src/fn/certification/ghg-statement-reports.ts:340](../../../../src/fn/certification/ghg-statement-reports.ts#L340) |
| `prepareGhgStatementReport` | [src/fn/certification/ghg-statement-reports.ts:352](../../../../src/fn/certification/ghg-statement-reports.ts#L352) |
| `approveGhgStatementReport` | [src/fn/certification/ghg-statement-reports.ts:448](../../../../src/fn/certification/ghg-statement-reports.ts#L448) |
| `loadGhgStatementReports` | [src/fn/certification/ghg-statement-reports.ts:478](../../../../src/fn/certification/ghg-statement-reports.ts#L478) |
| `reconcileGhgStatementsFromRegistry` | [src/fn/certification/ghg-statement-sync.ts:17](../../../../src/fn/certification/ghg-statement-sync.ts#L17) |
| `loadRegistryGhgStatements` | [src/fn/certification/ghg-statement-sync.ts:29](../../../../src/fn/certification/ghg-statement-sync.ts#L29) |
| `createGhgStatementDraft` | [src/fn/certification/ghg-statements.ts:201](../../../../src/fn/certification/ghg-statements.ts#L201) |
| `submitGhgStatementToVerifier` | [src/fn/certification/ghg-statements.ts:611](../../../../src/fn/certification/ghg-statements.ts#L611) |
| `refreshGhgStatementStatus` | [src/fn/certification/ghg-statements.ts:631](../../../../src/fn/certification/ghg-statements.ts#L631) |
| `loadGhgStatementState` | [src/fn/certification/ghg-statements.ts:708](../../../../src/fn/certification/ghg-statements.ts#L708) |
| `loadGhgStatementsForFacility` | [src/fn/certification/ghg-statements.ts:788](../../../../src/fn/certification/ghg-statements.ts#L788) |
| `loadOpenRemovalsForFacility` | [src/fn/certification/ghg-statements.ts:822](../../../../src/fn/certification/ghg-statements.ts#L822) |
| `loadCertificationHealth` | [src/fn/certification/health.ts:38](../../../../src/fn/certification/health.ts#L38) |
| `loadLinkedGhgStatementStatus` | [src/fn/certification/linked-ghg-statement-status.ts:22](../../../../src/fn/certification/linked-ghg-statement-status.ts#L22) |
| `loadRemovalPreflight` | [src/fn/certification/overview.ts:179](../../../../src/fn/certification/overview.ts#L179) |
| `loadCertificationOverview` | [src/fn/certification/overview.ts:216](../../../../src/fn/certification/overview.ts#L216) |
| `loadCreditBatchHealthSummaries` | [src/fn/certification/overview.ts:279](../../../../src/fn/certification/overview.ts#L279) |
| `ensureProductionBatchesForCreditBatches` | [src/fn/certification/production-batches.ts:180](../../../../src/fn/certification/production-batches.ts#L180) |
| `bindProductionBatchesToMeasurementSamples` | [src/fn/certification/production-batches.ts:379](../../../../src/fn/certification/production-batches.ts#L379) |
| `retireClaimedRemovalDraftForDrift` | [src/fn/certification/production-claim-gate.ts:46](../../../../src/fn/certification/production-claim-gate.ts#L46) |
| `assertProductionClaimGateFresh` | [src/fn/certification/production-claim-gate.ts:61](../../../../src/fn/certification/production-claim-gate.ts#L61) |
| `assertResumedSnapshotRevisionCurrent` | [src/fn/certification/production-claim-gate.ts:146](../../../../src/fn/certification/production-claim-gate.ts#L146) |
| `checkProtocolVersionAtSubmit` | [src/fn/certification/protocol-version-preflight.ts:30](../../../../src/fn/certification/protocol-version-preflight.ts#L30) |
| `performRegistryCreate` | [src/fn/certification/registry-create.ts:127](../../../../src/fn/certification/registry-create.ts#L127) |
| `loadRemovalBreakdown` | [src/fn/certification/removal-breakdown.ts:43](../../../../src/fn/certification/removal-breakdown.ts#L43) |
| `loadRemovalCompilation` | [src/fn/certification/removal-compilation.ts:35](../../../../src/fn/certification/removal-compilation.ts#L35) |
| `refreshInterruptedRemovalEvidence` | [src/fn/certification/removal-evidence-refresh.ts:17](../../../../src/fn/certification/removal-evidence-refresh.ts#L17) |
| `loadRemovalProductionBatches` | [src/fn/certification/removal-production-batches.ts:31](../../../../src/fn/certification/removal-production-batches.ts#L31) |
| `verifyAndPersistRemovalSourceBindings` | [src/fn/certification/removal-source-binding-verification.ts:27](../../../../src/fn/certification/removal-source-binding-verification.ts#L27) |
| `compileRemovalSubmission` | [src/fn/certification/removal-submission-build.ts:255](../../../../src/fn/certification/removal-submission-build.ts#L255) |
| `buildRemovalSubmissionBuild` | [src/fn/certification/removal-submission-build.ts:616](../../../../src/fn/certification/removal-submission-build.ts#L616) |
| `recordClaimedRemovalSubmissionFailureBestEffort` | [src/fn/certification/removal-submission-failure.ts:67](../../../../src/fn/certification/removal-submission-failure.ts#L67) |
| `persistRemovalReportingWindow` | [src/fn/certification/removal-submission-finalization.ts:34](../../../../src/fn/certification/removal-submission-finalization.ts#L34) |
| `recordRemovalConfirmedIdentity` | [src/fn/certification/removal-submission-finalization.ts:45](../../../../src/fn/certification/removal-submission-finalization.ts#L45) |
| `reconcileRemovalRegistryArtifacts` | [src/fn/certification/removal-submission-finalization.ts:77](../../../../src/fn/certification/removal-submission-finalization.ts#L77) |
| `recoverSubmittedRemoval` | [src/fn/certification/removal-submission-finalization.ts:116](../../../../src/fn/certification/removal-submission-finalization.ts#L116) |
| `finalizeRemovalSubmission` | [src/fn/certification/removal-submission-finalization.ts:154](../../../../src/fn/certification/removal-submission-finalization.ts#L154) |
| `assertClaimedRemovalPayloadFresh` | [src/fn/certification/removal-submission-freshness.ts:11](../../../../src/fn/certification/removal-submission-freshness.ts#L11) |
| `loadRemovalTemplateDiagnostic` | [src/fn/certification/removal-template-diagnostic.ts:42](../../../../src/fn/certification/removal-template-diagnostic.ts#L42) |
| `loadRemovalsForFacility` | [src/fn/certification/removals-hub.ts:46](../../../../src/fn/certification/removals-hub.ts#L46) |
| `buildSelectableBatchesData` | [src/fn/certification/selectable-batches.ts:52](../../../../src/fn/certification/selectable-batches.ts#L52) |
| `safeListIfConfigured` | [src/fn/certification/shared.ts:48](../../../../src/fn/certification/shared.ts#L48) |
| `appendSyncEventBestEffort` | [src/fn/certification/shared.ts:74](../../../../src/fn/certification/shared.ts#L74) |
| `loadTransportLegsByCategory` | [src/fn/certification/shared.ts:95](../../../../src/fn/certification/shared.ts#L95) |
| `loadCandidateDocumentsForRemovalForUser` | [src/fn/certification/source-candidates.ts:134](../../../../src/fn/certification/source-candidates.ts#L134) |
| `collectCandidateDocumentIdsForRemoval` | [src/fn/certification/source-candidates.ts:284](../../../../src/fn/certification/source-candidates.ts#L284) |
| `collectCandidateSourceDocumentsForRemoval` | [src/fn/certification/source-candidates.ts:310](../../../../src/fn/certification/source-candidates.ts#L310) |
| `resolveSourceBindingCandidates` | [src/fn/certification/source-candidates.ts:394](../../../../src/fn/certification/source-candidates.ts#L394) |
| `resolveSourceIdsForRemoval` | [src/fn/certification/source-candidates.ts:415](../../../../src/fn/certification/source-candidates.ts#L415) |
| `withSourceSyncEventOnFailure` | [src/fn/certification/source-sync-events.ts:20](../../../../src/fn/certification/source-sync-events.ts#L20) |
| `loadRegistrySourceVisibility` | [src/fn/certification/source-visibility.ts:22](../../../../src/fn/certification/source-visibility.ts#L22) |
| `saveRegistrySourceVisibility` | [src/fn/certification/source-visibility.ts:37](../../../../src/fn/certification/source-visibility.ts#L37) |
| `downloadDocumentBlob` | [src/fn/certification/sources-transfer.ts:61](../../../../src/fn/certification/sources-transfer.ts#L61) |
| `putBlobToSignedUrl` | [src/fn/certification/sources-transfer.ts:100](../../../../src/fn/certification/sources-transfer.ts#L100) |
| `loadCandidateDocumentsForRemovalForUser` | [src/fn/certification/sources.ts:69](../../../../src/fn/certification/sources.ts#L69) |
| `collectCandidateDocumentIdsForRemoval` | [src/fn/certification/sources.ts:75](../../../../src/fn/certification/sources.ts#L75) |
| `collectCandidateSourceDocumentsForRemoval` | [src/fn/certification/sources.ts:81](../../../../src/fn/certification/sources.ts#L81) |
| `resolveSourceBindingCandidates` | [src/fn/certification/sources.ts:87](../../../../src/fn/certification/sources.ts#L87) |
| `resolveSourceIdsForRemoval` | [src/fn/certification/sources.ts:93](../../../../src/fn/certification/sources.ts#L93) |
| `loadCandidateDocumentsForRemoval` | [src/fn/certification/sources.ts:99](../../../../src/fn/certification/sources.ts#L99) |
| `mirrorCandidateSourcesForSubmission` | [src/fn/certification/sources.ts:184](../../../../src/fn/certification/sources.ts#L184) |
| `mirrorDocumentToSource` | [src/fn/certification/sources.ts:269](../../../../src/fn/certification/sources.ts#L269) |
| `mirrorDocumentToSourceForUser` | [src/fn/certification/sources.ts:281](../../../../src/fn/certification/sources.ts#L281) |
| `loadApplicationStorageLocationSync` | [src/fn/certification/storage-location-actions.ts:51](../../../../src/fn/certification/storage-location-actions.ts#L51) |
| `syncApplicationStorageLocation` | [src/fn/certification/storage-location-actions.ts:62](../../../../src/fn/certification/storage-location-actions.ts#L62) |
| `ensureStorageLocation` | [src/fn/certification/storage-locations.ts:88](../../../../src/fn/certification/storage-locations.ts#L88) |
| `submitGhgStatementToVerifierCore` | [src/fn/certification/submit-ghg-statement.ts:235](../../../../src/fn/certification/submit-ghg-statement.ts#L235) |
| `submitRemoval` | [src/fn/certification/submit-removal.ts:145](../../../../src/fn/certification/submit-removal.ts#L145) |
| `submitTelemetryAction` | [src/fn/certification/submit-telemetry.ts:104](../../../../src/fn/certification/submit-telemetry.ts#L104) |
| `submitTelemetry` | [src/fn/certification/submit-telemetry.ts:120](../../../../src/fn/certification/submit-telemetry.ts#L120) |
| `loadTelemetrySubmissionState` | [src/fn/certification/submit-telemetry.ts:745](../../../../src/fn/certification/submit-telemetry.ts#L745) |
| `setOrgCertifierCredentialsFn` | [src/fn/certifier-credentials.ts:75](../../../../src/fn/certifier-credentials.ts#L75) |
| `getOrgCertifierCredentialsStatusFn` | [src/fn/certifier-credentials.ts:152](../../../../src/fn/certifier-credentials.ts#L152) |
| `getChainOfCustodyFn` | [src/fn/chain-of-custody.ts:27](../../../../src/fn/chain-of-custody.ts#L27) |
| `getChainOfCustodyGeoFn` | [src/fn/chain-of-custody.ts:42](../../../../src/fn/chain-of-custody.ts#L42) |
| `getCreditBatchChainFn` | [src/fn/chain-of-custody.ts:57](../../../../src/fn/chain-of-custody.ts#L57) |
| `getCreditBatchChainGeoFn` | [src/fn/chain-of-custody.ts:72](../../../../src/fn/chain-of-custody.ts#L72) |
| `getApplicationTrailFn` | [src/fn/chain-of-custody.ts:87](../../../../src/fn/chain-of-custody.ts#L87) |
| `getCreditBatchesFn` | [src/fn/credit-batches.ts:46](../../../../src/fn/credit-batches.ts#L46) |
| `getCreditBatchByIdFn` | [src/fn/credit-batches.ts:71](../../../../src/fn/credit-batches.ts#L71) |
| `getCo2eStoredPreviewsFn` | [src/fn/credit-batches.ts:92](../../../../src/fn/credit-batches.ts#L92) |
| `getCreditBatchProductionRunOptionsFn` | [src/fn/credit-batches.ts:123](../../../../src/fn/credit-batches.ts#L123) |
| `createCreditBatchFn` | [src/fn/credit-batches.ts:156](../../../../src/fn/credit-batches.ts#L156) |
| `updateCreditBatchFn` | [src/fn/credit-batches.ts:189](../../../../src/fn/credit-batches.ts#L189) |
| `deleteCreditBatchFn` | [src/fn/credit-batches.ts:239](../../../../src/fn/credit-batches.ts#L239) |
| `getCustomersFn` | [src/fn/customers.ts:63](../../../../src/fn/customers.ts#L63) |
| `getCustomerWithRelationsFn` | [src/fn/customers.ts:96](../../../../src/fn/customers.ts#L96) |
| `getCustomerLocationsFn` | [src/fn/customers.ts:119](../../../../src/fn/customers.ts#L119) |
| `createCustomerFn` | [src/fn/customers.ts:165](../../../../src/fn/customers.ts#L165) |
| `updateCustomerFn` | [src/fn/customers.ts:217](../../../../src/fn/customers.ts#L217) |
| `deleteCustomerFn` | [src/fn/customers.ts:260](../../../../src/fn/customers.ts#L260) |
| `createCustomerLocationFn` | [src/fn/customers.ts:295](../../../../src/fn/customers.ts#L295) |
| `updateCustomerLocationFn` | [src/fn/customers.ts:344](../../../../src/fn/customers.ts#L344) |
| `deleteCustomerLocationFn` | [src/fn/customers.ts:393](../../../../src/fn/customers.ts#L393) |
| `getDashboardOverviewFn` | [src/fn/dashboard-overview.ts:32](../../../../src/fn/dashboard-overview.ts#L32) |
| `getDeliveriesFn` | [src/fn/deliveries.ts:67](../../../../src/fn/deliveries.ts#L67) |
| `getDeliveryWithRelationsFn` | [src/fn/deliveries.ts:103](../../../../src/fn/deliveries.ts#L103) |
| `getDeliveryStatsFn` | [src/fn/deliveries.ts:126](../../../../src/fn/deliveries.ts#L126) |
| `createDeliveryFn` | [src/fn/deliveries.ts:162](../../../../src/fn/deliveries.ts#L162) |
| `updateDeliveryFn` | [src/fn/deliveries.ts:225](../../../../src/fn/deliveries.ts#L225) |
| `deleteDeliveryFn` | [src/fn/deliveries.ts:279](../../../../src/fn/deliveries.ts#L279) |
| `requestUpload` | [src/fn/documents.ts:91](../../../../src/fn/documents.ts#L91) |
| `confirmUpload` | [src/fn/documents.ts:185](../../../../src/fn/documents.ts#L185) |
| `setDocumentVisibility` | [src/fn/documents.ts:263](../../../../src/fn/documents.ts#L263) |
| `updateApplicationEvidenceMetadata` | [src/fn/documents.ts:277](../../../../src/fn/documents.ts#L277) |
| `deleteDocument` | [src/fn/documents.ts:321](../../../../src/fn/documents.ts#L321) |
| `getDocumentsForEntity` | [src/fn/documents.ts:338](../../../../src/fn/documents.ts#L338) |
| `searchEntitiesFn` | [src/fn/entities.ts:66](../../../../src/fn/entities.ts#L66) |
| `getEntityByIdFn` | [src/fn/entities.ts:87](../../../../src/fn/entities.ts#L87) |
| `getFacilitiesFn` | [src/fn/facilities.ts:59](../../../../src/fn/facilities.ts#L59) |
| `getFacilityByIdFn` | [src/fn/facilities.ts:92](../../../../src/fn/facilities.ts#L92) |
| `getFacilityCountriesFn` | [src/fn/facilities.ts:116](../../../../src/fn/facilities.ts#L116) |
| `createFacilityFn` | [src/fn/facilities.ts:145](../../../../src/fn/facilities.ts#L145) |
| `updateFacilityFn` | [src/fn/facilities.ts:202](../../../../src/fn/facilities.ts#L202) |
| `getFacilityArchiveImpactFn` | [src/fn/facilities.ts:250](../../../../src/fn/facilities.ts#L250) |
| `archiveFacilityFn` | [src/fn/facilities.ts:273](../../../../src/fn/facilities.ts#L273) |
| `restoreFacilityFn` | [src/fn/facilities.ts:304](../../../../src/fn/facilities.ts#L304) |
| `listFeedstockTypesFn` | [src/fn/feedstock-types.ts:32](../../../../src/fn/feedstock-types.ts#L32) |
| `createFeedstockTypeFn` | [src/fn/feedstock-types.ts:38](../../../../src/fn/feedstock-types.ts#L38) |
| `updateFeedstockTypeFn` | [src/fn/feedstock-types.ts:54](../../../../src/fn/feedstock-types.ts#L54) |
| `archiveFeedstockTypeFn` | [src/fn/feedstock-types.ts:62](../../../../src/fn/feedstock-types.ts#L62) |
| `unarchiveFeedstockTypeFn` | [src/fn/feedstock-types.ts:71](../../../../src/fn/feedstock-types.ts#L71) |
| `deleteFeedstockTypeFn` | [src/fn/feedstock-types.ts:80](../../../../src/fn/feedstock-types.ts#L80) |
| `importIsometricFeedstockTypeFn` | [src/fn/feedstock-types.ts:89](../../../../src/fn/feedstock-types.ts#L89) |
| `getFeedstocksFn` | [src/fn/feedstocks.ts:54](../../../../src/fn/feedstocks.ts#L54) |
| `getFeedstockByIdFn` | [src/fn/feedstocks.ts:87](../../../../src/fn/feedstocks.ts#L87) |
| `getFeedstockStatsFn` | [src/fn/feedstocks.ts:107](../../../../src/fn/feedstocks.ts#L107) |
| `createFeedstockFn` | [src/fn/feedstocks.ts:143](../../../../src/fn/feedstocks.ts#L143) |
| `updateFeedstockFn` | [src/fn/feedstocks.ts:190](../../../../src/fn/feedstocks.ts#L190) |
| `deleteFeedstockFn` | [src/fn/feedstocks.ts:236](../../../../src/fn/feedstocks.ts#L236) |
| `getFormulationsFn` | [src/fn/formulations.ts:54](../../../../src/fn/formulations.ts#L54) |
| `getFormulationByIdFn` | [src/fn/formulations.ts:87](../../../../src/fn/formulations.ts#L87) |
| `createFormulationFn` | [src/fn/formulations.ts:114](../../../../src/fn/formulations.ts#L114) |
| `updateFormulationFn` | [src/fn/formulations.ts:168](../../../../src/fn/formulations.ts#L168) |
| `deleteFormulationFn` | [src/fn/formulations.ts:213](../../../../src/fn/formulations.ts#L213) |
| `getGeoCapabilitiesFn` | [src/fn/geo.ts:37](../../../../src/fn/geo.ts#L37) |
| `geocodeAddressFn` | [src/fn/geo.ts:41](../../../../src/fn/geo.ts#L41) |
| `reverseGeocodeFn` | [src/fn/geo.ts:53](../../../../src/fn/geo.ts#L53) |
| `routeDistanceFn` | [src/fn/geo.ts:65](../../../../src/fn/geo.ts#L65) |
| `routeGeometriesFn` | [src/fn/geo.ts:82](../../../../src/fn/geo.ts#L82) |
| `normalizeGisBoundaryFn` | [src/fn/gis-boundary.ts:32](../../../../src/fn/gis-boundary.ts#L32) |
| `getInvitationBootstrapState` | [src/fn/invitation-bootstrap.ts:56](../../../../src/fn/invitation-bootstrap.ts#L56) |
| `bootstrapInvitationAccountAction` | [src/fn/invitation-bootstrap.ts:71](../../../../src/fn/invitation-bootstrap.ts#L71) |
| `fetchOnboardingStatus` | [src/fn/onboarding.ts:19](../../../../src/fn/onboarding.ts#L19) |
| `getOrdersFn` | [src/fn/orders.ts:40](../../../../src/fn/orders.ts#L40) |
| `getOrdersForSelectFn` | [src/fn/orders.ts:59](../../../../src/fn/orders.ts#L59) |
| `createOrderFn` | [src/fn/orders.ts:95](../../../../src/fn/orders.ts#L95) |
| `updateOrderFn` | [src/fn/orders.ts:132](../../../../src/fn/orders.ts#L132) |
| `deleteOrderFn` | [src/fn/orders.ts:160](../../../../src/fn/orders.ts#L160) |
| `loadOrganizationDefaults` | [src/fn/organization-settings.ts:22](../../../../src/fn/organization-settings.ts#L22) |
| `saveOrganizationDefaults` | [src/fn/organization-settings.ts:34](../../../../src/fn/organization-settings.ts#L34) |
| `listMembersFn` | [src/fn/organizations.ts:105](../../../../src/fn/organizations.ts#L105) |
| `listInvitationsFn` | [src/fn/organizations.ts:112](../../../../src/fn/organizations.ts#L112) |
| `listOrganizationsFn` | [src/fn/organizations.ts:122](../../../../src/fn/organizations.ts#L122) |
| `inviteMemberAction` | [src/fn/organizations.ts:133](../../../../src/fn/organizations.ts#L133) |
| `revokeInvitationAction` | [src/fn/organizations.ts:154](../../../../src/fn/organizations.ts#L154) |
| `changeMemberRoleAction` | [src/fn/organizations.ts:175](../../../../src/fn/organizations.ts#L175) |
| `removeMemberAction` | [src/fn/organizations.ts:196](../../../../src/fn/organizations.ts#L196) |
| `setActiveOrganizationAction` | [src/fn/organizations.ts:226](../../../../src/fn/organizations.ts#L226) |
| `createOrganizationAction` | [src/fn/organizations.ts:285](../../../../src/fn/organizations.ts#L285) |
| `acceptInvitationAction` | [src/fn/organizations.ts:314](../../../../src/fn/organizations.ts#L314) |
| `getActiveOrganizationProfile` | [src/fn/organizations.ts:345](../../../../src/fn/organizations.ts#L345) |
| `getProductionIncidentsFn` | [src/fn/production-incidents.ts:32](../../../../src/fn/production-incidents.ts#L32) |
| `createProductionIncidentFn` | [src/fn/production-incidents.ts:55](../../../../src/fn/production-incidents.ts#L55) |
| `updateProductionIncidentFn` | [src/fn/production-incidents.ts:94](../../../../src/fn/production-incidents.ts#L94) |
| `deleteProductionIncidentFn` | [src/fn/production-incidents.ts:135](../../../../src/fn/production-incidents.ts#L135) |
| `getMethodBEligibilityFn` | [src/fn/production-processes.ts:24](../../../../src/fn/production-processes.ts#L24) |
| `recordMethodBPrerequisitesFn` | [src/fn/production-processes.ts:32](../../../../src/fn/production-processes.ts#L32) |
| `startNewProductionProcessFn` | [src/fn/production-processes.ts:44](../../../../src/fn/production-processes.ts#L44) |
| `importProductionRunReadingsFromDocumentFn` | [src/fn/production-run-reading-imports.ts:35](../../../../src/fn/production-run-reading-imports.ts#L35) |
| `getProductionRunReadingsListFn` | [src/fn/production-run-readings.ts:28](../../../../src/fn/production-run-readings.ts#L28) |
| `deleteAllProductionRunReadingsFn` | [src/fn/production-run-readings.ts:63](../../../../src/fn/production-run-readings.ts#L63) |
| `getProductionRunsFn` | [src/fn/production-runs.ts:65](../../../../src/fn/production-runs.ts#L65) |
| `getProductionRunByIdFn` | [src/fn/production-runs.ts:101](../../../../src/fn/production-runs.ts#L101) |
| `getProductionRunStatsFn` | [src/fn/production-runs.ts:124](../../../../src/fn/production-runs.ts#L124) |
| `getFacilityEnergyTotalsFn` | [src/fn/production-runs.ts:150](../../../../src/fn/production-runs.ts#L150) |
| `getProductionRunReadingsFn` | [src/fn/production-runs.ts:174](../../../../src/fn/production-runs.ts#L174) |
| `createProductionRunFn` | [src/fn/production-runs.ts:201](../../../../src/fn/production-runs.ts#L201) |
| `updateProductionRunFn` | [src/fn/production-runs.ts:271](../../../../src/fn/production-runs.ts#L271) |
| `deleteProductionRunFn` | [src/fn/production-runs.ts:339](../../../../src/fn/production-runs.ts#L339) |
| `getProductionSamplesFn` | [src/fn/production-samples.ts:41](../../../../src/fn/production-samples.ts#L41) |
| `createProductionSampleFn` | [src/fn/production-samples.ts:71](../../../../src/fn/production-samples.ts#L71) |
| `updateProductionSampleFn` | [src/fn/production-samples.ts:128](../../../../src/fn/production-samples.ts#L128) |
| `deleteProductionSampleFn` | [src/fn/production-samples.ts:177](../../../../src/fn/production-samples.ts#L177) |
| `createDriverFn` | [src/fn/quick-add.ts:42](../../../../src/fn/quick-add.ts#L42) |
| `createOperatorFn` | [src/fn/quick-add.ts:60](../../../../src/fn/quick-add.ts#L60) |
| `createVehicleFn` | [src/fn/quick-add.ts:76](../../../../src/fn/quick-add.ts#L76) |
| `createFeedstockTypeFn` | [src/fn/quick-add.ts:97](../../../../src/fn/quick-add.ts#L97) |
| `createStorageLocationFn` | [src/fn/quick-add.ts:118](../../../../src/fn/quick-add.ts#L118) |
| `getReactorsFn` | [src/fn/reactors.ts:53](../../../../src/fn/reactors.ts#L53) |
| `createReactorFn` | [src/fn/reactors.ts:93](../../../../src/fn/reactors.ts#L93) |
| `updateReactorFn` | [src/fn/reactors.ts:145](../../../../src/fn/reactors.ts#L145) |
| `deleteReactorFn` | [src/fn/reactors.ts:188](../../../../src/fn/reactors.ts#L188) |
| `getSamplesFn` | [src/fn/samples.ts:77](../../../../src/fn/samples.ts#L77) |
| `getSampleByIdFn` | [src/fn/samples.ts:113](../../../../src/fn/samples.ts#L113) |
| `getSampleStatsFn` | [src/fn/samples.ts:136](../../../../src/fn/samples.ts#L136) |
| `createSampleFn` | [src/fn/samples.ts:177](../../../../src/fn/samples.ts#L177) |
| `updateSampleFn` | [src/fn/samples.ts:279](../../../../src/fn/samples.ts#L279) |
| `deleteSampleFn` | [src/fn/samples.ts:389](../../../../src/fn/samples.ts#L389) |
| `getStockAvailabilityFn` | [src/fn/stock-availability.ts:7](../../../../src/fn/stock-availability.ts#L7) |
| `getStorageLocationsFn` | [src/fn/storage-locations.ts:58](../../../../src/fn/storage-locations.ts#L58) |
| `createStorageLocationFn` | [src/fn/storage-locations.ts:101](../../../../src/fn/storage-locations.ts#L101) |
| `updateStorageLocationFn` | [src/fn/storage-locations.ts:156](../../../../src/fn/storage-locations.ts#L156) |
| `archiveStorageLocationFn` | [src/fn/storage-locations.ts:207](../../../../src/fn/storage-locations.ts#L207) |
| `restoreStorageLocationFn` | [src/fn/storage-locations.ts:222](../../../../src/fn/storage-locations.ts#L222) |
| `deleteStorageLocationFn` | [src/fn/storage-locations.ts:241](../../../../src/fn/storage-locations.ts#L241) |
| `getSuppliersFn` | [src/fn/suppliers.ts:63](../../../../src/fn/suppliers.ts#L63) |
| `getSupplierByIdFn` | [src/fn/suppliers.ts:96](../../../../src/fn/suppliers.ts#L96) |
| `createSupplierFn` | [src/fn/suppliers.ts:123](../../../../src/fn/suppliers.ts#L123) |
| `createSupplierWithLocationsFn` | [src/fn/suppliers.ts:177](../../../../src/fn/suppliers.ts#L177) |
| `updateSupplierFn` | [src/fn/suppliers.ts:252](../../../../src/fn/suppliers.ts#L252) |
| `deleteSupplierFn` | [src/fn/suppliers.ts:304](../../../../src/fn/suppliers.ts#L304) |
| `getSupplierLocationsBySupplierFn` | [src/fn/suppliers.ts:336](../../../../src/fn/suppliers.ts#L336) |
| `createSupplierLocationFn` | [src/fn/suppliers.ts:361](../../../../src/fn/suppliers.ts#L361) |
| `updateSupplierLocationFn` | [src/fn/suppliers.ts:405](../../../../src/fn/suppliers.ts#L405) |
| `deleteSupplierLocationFn` | [src/fn/suppliers.ts:448](../../../../src/fn/suppliers.ts#L448) |
| `getTransportLegsForEntityFn` | [src/fn/transport-legs.ts:30](../../../../src/fn/transport-legs.ts#L30) |
| `createTransportLegFn` | [src/fn/transport-legs.ts:40](../../../../src/fn/transport-legs.ts#L40) |
| `updateTransportLegFn` | [src/fn/transport-legs.ts:54](../../../../src/fn/transport-legs.ts#L54) |
| `deleteTransportLegFn` | [src/fn/transport-legs.ts:66](../../../../src/fn/transport-legs.ts#L66) |
| `withAction` | [src/fn/with-action.ts:49](../../../../src/fn/with-action.ts#L49) |

## Database table ownership inventory

Tables with no standalone route still need lifecycle ownership. This list preserves internal journals, join rows, and legacy tables that a route-only audit would miss.

| Table constant | Database table | Schema |
|---|---|---|
| `applications` | `applications` | [application.ts](../../../../src/db/schema/application.ts) |
| `soilTemperatureMeasurements` | `soil_temperature_measurements` | [application.ts](../../../../src/db/schema/application.ts) |
| `users` | `users` | [auth.ts](../../../../src/db/schema/auth.ts) |
| `sessions` | `session` | [auth.ts](../../../../src/db/schema/auth.ts) |
| `accounts` | `account` | [auth.ts](../../../../src/db/schema/auth.ts) |
| `verifications` | `verification` | [auth.ts](../../../../src/db/schema/auth.ts) |
| `organizations` | `organizations` | [auth.ts](../../../../src/db/schema/auth.ts) |
| `members` | `members` | [auth.ts](../../../../src/db/schema/auth.ts) |
| `invitations` | `invitations` | [auth.ts](../../../../src/db/schema/auth.ts) |
| `binMovements` | `bin_movements` | [bin-movements.ts](../../../../src/db/schema/bin-movements.ts) |
| `certifierCredentials` | `certifier_credentials` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierOrganizationSettings` | `certifier_organization_settings` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierProjects` | `certifier_projects` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierSensors` | `certifier_sensors` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierGhgStatements` | `certifier_ghg_statements` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierGhgStatementReports` | `certifier_ghg_statement_reports` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierRemovals` | `certifier_removals` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certificationSubmissions` | `certification_submissions` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierDocumentUploads` | `certifier_document_uploads` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierSyncEvents` | `certifier_sync_events` | [certification.ts](../../../../src/db/schema/certification.ts) |
| `certifierBiocharApplications` | `certifier_biochar_applications` | [certifier-biochar-applications.ts](../../../../src/db/schema/certifier-biochar-applications.ts) |
| `certifierProductionBatches` | `certifier_production_batches` | [certifier-production-batches.ts](../../../../src/db/schema/certifier-production-batches.ts) |
| `certifierStorageLocations` | `certifier_storage_locations` | [certifier-storage-locations.ts](../../../../src/db/schema/certifier-storage-locations.ts) |
| `stockpileEvents` | `stockpile_events` | [compliance.ts](../../../../src/db/schema/compliance.ts) |
| `powerProcurementEvidence` | `power_procurement_evidence` | [compliance.ts](../../../../src/db/schema/compliance.ts) |
| `creditBatches` | `credit_batches` | [credits.ts](../../../../src/db/schema/credits.ts) |
| `creditBatchApplications` | `credit_batch_applications` | [credits.ts](../../../../src/db/schema/credits.ts) |
| `creditBatchProductionRuns` | `credit_batch_production_runs` | [credits.ts](../../../../src/db/schema/credits.ts) |
| `documents` | `documents` | [documentation.ts](../../../../src/db/schema/documentation.ts) |
| `storageObjectDeletions` | `storage_object_deletions` | [documentation.ts](../../../../src/db/schema/documentation.ts) |
| `facilities` | `facilities` | [facilities.ts](../../../../src/db/schema/facilities.ts) |
| `reactors` | `reactors` | [facilities.ts](../../../../src/db/schema/facilities.ts) |
| `storageLocations` | `storage_locations` | [facilities.ts](../../../../src/db/schema/facilities.ts) |
| `feedstockDeliveries` | `feedstock_deliveries` | [feedstock.ts](../../../../src/db/schema/feedstock.ts) |
| `feedstockTypes` | `feedstock_types` | [feedstock.ts](../../../../src/db/schema/feedstock.ts) |
| `feedstocks` | `feedstocks` | [feedstock.ts](../../../../src/db/schema/feedstock.ts) |
| `geoRouteCache` | `geo_route_cache` | [geo.ts](../../../../src/db/schema/geo.ts) |
| `vehicles` | `vehicles` | [logistics.ts](../../../../src/db/schema/logistics.ts) |
| `orders` | `orders` | [logistics.ts](../../../../src/db/schema/logistics.ts) |
| `deliveries` | `deliveries` | [logistics.ts](../../../../src/db/schema/logistics.ts) |
| `transportLegs` | `transport_legs` | [logistics.ts](../../../../src/db/schema/logistics.ts) |
| `suppliers` | `suppliers` | [parties.ts](../../../../src/db/schema/parties.ts) |
| `customers` | `customers` | [parties.ts](../../../../src/db/schema/parties.ts) |
| `customerLocations` | `customer_locations` | [parties.ts](../../../../src/db/schema/parties.ts) |
| `supplierLocations` | `supplier_locations` | [parties.ts](../../../../src/db/schema/parties.ts) |
| `drivers` | `drivers` | [parties.ts](../../../../src/db/schema/parties.ts) |
| `operators` | `operators` | [parties.ts](../../../../src/db/schema/parties.ts) |
| `productionProcesses` | `production_processes` | [production-processes.ts](../../../../src/db/schema/production-processes.ts) |
| `productionRuns` | `production_runs` | [production.ts](../../../../src/db/schema/production.ts) |
| `productionRunReadings` | `production_run_readings` | [production.ts](../../../../src/db/schema/production.ts) |
| `samples` | `samples` | [production.ts](../../../../src/db/schema/production.ts) |
| `incidentReports` | `incident_reports` | [production.ts](../../../../src/db/schema/production.ts) |
| `productionRunFeedstocks` | `production_run_feedstocks` | [production.ts](../../../../src/db/schema/production.ts) |
| `productionRunFeedstockDraws` | `production_run_feedstock_draws` | [production.ts](../../../../src/db/schema/production.ts) |
| `productionSamples` | `production_samples` | [production.ts](../../../../src/db/schema/production.ts) |
| `formulations` | `formulations` | [products.ts](../../../../src/db/schema/products.ts) |
| `formulationIngredients` | `formulation_ingredients` | [products.ts](../../../../src/db/schema/products.ts) |
| `biocharProducts` | `biochar_products` | [products.ts](../../../../src/db/schema/products.ts) |
| `biocharProductSourceAllocations` | `biochar_product_source_allocations` | [products.ts](../../../../src/db/schema/products.ts) |
| `organizationSettings` | `organization_settings` | [settings.ts](../../../../src/db/schema/settings.ts) |
| `biocharStorageInventory` | `biochar_storage_inventory` | [storage-inventory.ts](../../../../src/db/schema/storage-inventory.ts) |
