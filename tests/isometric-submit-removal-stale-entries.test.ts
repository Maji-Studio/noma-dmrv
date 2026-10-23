import { expect, it, vi } from "vitest";
import { REMOVAL_ID, USER_ID, CREDIT_BATCH_ID, makeContext, storedRows, fakeExternalIds } from "./fixtures/submit-removal-orchestrator";
import { makeTestOrgContext } from "./helpers/test-org";
import { loadRemovalSubmissionContext } from "@/fn/certification/certify-context-core";
import { frozenEntriesForAttempt, loadRemovalEntryContext } from "@/fn/certification/removal-entry-context";
import type { BatchEmissionContext } from "@/fn/certification/batch-emission-context";
import type { RemovalScope } from "@/fn/certification/removal-scope";
import type { FacilityCertifierFacts } from "@/fn/certification/facility-certifier-facts";
import { submitRemoval } from "@/fn/certification/submit-removal";
import * as isometric from "@/lib/isometric";
vi.mock("@/data-access/emission-entry-contenders", () => ({ loadEmissionEntryReservations: vi.fn(async () => []) }));

it("heals a crashed unreserved draft after a new entry is added and submits a new version", async () => {
  const org = makeTestOrgContext(USER_ID);
  vi.mocked(loadRemovalSubmissionContext).mockImplementation(async () => makeContext());
  vi.mocked(isometric.createDatapoint).mockImplementation(vi.fn(fakeExternalIds("dp")) as never);
  vi.mocked(isometric.createGhgEntry).mockImplementation(vi.fn(fakeExternalIds("rmv")) as never);
  await submitRemoval({ orgCtx: org, removalId: REMOVAL_ID });
  // Retain a complete modern snapshot, but model a process that died before reservation or registry writes.
  const row = storedRows[0];
  Object.assign(row, { status: "draft", externalId: null, submittedAt: null, metadata: null, lockedAt: new Date(0),
    payloadSnapshot: { ...row.payloadSnapshot as object, frozenEntrySet: [] } });
  vi.mocked(isometric.createDatapoint).mockClear();
  vi.mocked(isometric.createGhgEntry).mockClear();
  const batchFacts = { [CREDIT_BATCH_ID]: { entries: [{ id: "entry", creditBatchId: CREDIT_BATCH_ID,
    componentId: "line", kind: "value", contentRevision: 2, occurredOn: "2026-01-02", counts: true,
    values: [{ inputKey: "electricity_use", magnitude: "2", unit: "kWh" }], evidenceDocumentIds: ["doc-test-1"], sendReservedBySubmissionId: null }], previousObservations: new Map(), automaticFigures: {}, contenders: [{ contenderKind: "draft", removalId: REMOVAL_ID, creditBatchIds: [CREDIT_BATCH_ID], createdAt: "2026-01-01", window: { start: "2026-01-01", end: "2026-02-01" } }] } } as unknown as BatchEmissionContext;
  const scope = { removalId: REMOVAL_ID, memberBatches: [{ id: CREDIT_BATCH_ID, removalTemplateId: "template", startDate: "2026-01-01" }],
    lineages: [{ application: { applicationDate: new Date("2026-02-01") } }] } as RemovalScope;
  const facility = { facilityTimezone: "UTC", templatesById: { template: { observation: { id: "observation", semanticFingerprint: "fingerprint", lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
    definition: { groups: [{ components: [{ id: "line", inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] },
    enrichment: { line: { electricity_use: { unit: "kWh" } } } } } } } as unknown as FacilityCertifierFacts;
  let loadedFresh = false;
  vi.mocked(loadRemovalSubmissionContext).mockImplementation(async () => {
    const context = makeContext();
    const frozen = frozenEntriesForAttempt(context.latestSubmission, { batchFacts });
    const entries = await loadRemovalEntryContext(org, scope, { batchFacts }, facility, frozen);
    context.removalEntryContext = entries;
    loadedFresh = true;
    return context;
  });
  vi.mocked(isometric.createDatapoint).mockImplementation(vi.fn(fakeExternalIds("dp")) as never);
  vi.mocked(isometric.createGhgEntry).mockImplementation(vi.fn(fakeExternalIds("rmv")) as never);
  // The initial read succeeds. Once reclaimed, the new entry changes the rebuilt hash and retires the attempt.
  await expect(submitRemoval({ orgCtx: org, removalId: REMOVAL_ID })).rejects.toThrow("stale draft was retired");
  expect(loadedFresh).toBe(true);
  expect(row.status).toBe("superseded");
  expect(isometric.createGhgEntry).not.toHaveBeenCalled();
  await expect(submitRemoval({ orgCtx: org, removalId: REMOVAL_ID })).resolves.toMatchObject({ version: 2 });
  expect(isometric.createGhgEntry).toHaveBeenCalledOnce();
});
