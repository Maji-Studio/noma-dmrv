/** Real handlers, credentials and Postgres. Written for reviewer execution; never run by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, samples } from "@/db/schema";
import { labSampleRepresentationSchema } from "@/lib/representations/lab-samples";
import { LINEAGE_LOCKED_COPY } from "./helpers/certified-output-lineage";
import { assignRemoval } from "./helpers/lab-sample-fixture";
import { createApiLabFixture, expectProblem, removeApiLabFixture, type ApiLabFixture } from "./helpers/api-lab-sample-fixture";
import {
  deleteLabSample, EXPECTED_H_TO_C, expectNoLabSampleWrite, FUTURE_AT, labIdempotencyRecords, labSampleAudits, labSampleBody, labSampleRows,
  patchLabSample, postLabSample, readRestLabSample, requiredEtag, seedRestLabSample, WRITE_SAMPLED_AT,
} from "./helpers/api-lab-sample-write-fixture";
import { uppercaseUuids } from "./helpers/uppercase-uuids";

const TIMEOUT_MS = 60_000;
const AUGUST_SAMPLED_AT = "2026-08-10T08:00:00.000Z";
const BEFORE_WINDOW_AT = "2026-08-20T08:00:00.000Z";
const H_TO_C_NOTICE = `H/C_org calculated from hydrogen and organic carbon: ${EXPECTED_H_TO_C.toFixed(4)}`;
const PRIVATE_FIELDS = ["organizationId", "facilityId", "durabilityOption", "productionRunId", "sampleCode", "hToCOrg", "cursorCreatedAt"];
let a: ApiLabFixture;
let b: ApiLabFixture;
beforeEach(async () => {
  a = await createApiLabFixture();
  b = await createApiLabFixture();
}, TIMEOUT_MS);
afterEach(async () => { await removeApiLabFixture(a); await removeApiLabFixture(b); }, TIMEOUT_MS);

describe("lab sample create", { timeout: TIMEOUT_MS }, () => {
  it("creates a sample with Location, a strong ETag, the calculated ratio, one audit row and no values in the audit", async () => {
    const response = await postLabSample(a, labSampleBody(a, { totalOxygenPercent: 8 }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["data", "warnings"]);
    const { data } = body;
    expect(labSampleRepresentationSchema.parse(data)).toEqual(data);
    expect(response.headers.get("location")).toBe(`/api/v1/lab-samples/${data.id}`);
    expect(response.headers.get("etag")).toBe('"1.1"');
    expect(response.headers.has("idempotent-replayed")).toBe(false);
    expect(data).toMatchObject({
      version: 1, creditBatchId: a.batchA.id, samplingTime: WRITE_SAMPLED_AT, totalCarbonPercent: 80, organicCarbonPercent: 75,
      totalHydrogenPercent: 1.5, hToCOrgRatio: EXPECTED_H_TO_C, labName: null,
    });
    expect(data.oToCOrgRatio).toEqual(expect.any(Number));
    for (const field of PRIVATE_FIELDS) expect(data).not.toHaveProperty(field);
    // Notices come first, one per calculated ratio, then certification warnings.
    expect(body.warnings[0]).toBe(H_TO_C_NOTICE);
    expect(body.warnings[1]).toMatch(/^O\/C_org calculated from oxygen and organic carbon: \d\.\d{4}$/);
    expect(await readRestLabSample(a, data.id)).toEqual({ row: data, etag: '"1.1"' });
    expect(await labSampleRows(a)).toMatchObject([{ id: data.id, sampleCode: data.code, hToCOrgRatio: EXPECTED_H_TO_C }]);
    const audits = await labSampleAudits(a);
    expect(audits).toMatchObject([{
      operationId: "record_lab_sample", outcomeCode: "created", transport: "rest", credentialId: a.writeCredentialId,
      entityIds: [data.id], versionBefore: null, versionAfter: 1,
    }]);
    expect(audits[0].changedFields).toEqual(expect.arrayContaining(["creditBatchId", "totalCarbonPercent", "totalHydrogenPercent"]));
    expect(JSON.stringify(audits[0])).not.toContain(WRITE_SAMPLED_AT);
  });

  it("answers with certification warnings but no calculated-ratio notice when hydrogen and moisture are missing", async () => {
    const response = await postLabSample(a, labSampleBody(a, { totalHydrogenPercent: undefined, moistureContentPercent: undefined }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.hToCOrgRatio).toBeNull();
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/has no total hydrogen, so H\/C_org cannot be calculated/),
      expect.stringMatching(/has no moisture content/),
    ]));
    expect(body.warnings.some((warning: string) => warning.startsWith("H/C_org calculated"))).toBe(false);
  });

  it("reads a facility-local time in the credit batch facility's zone", async () => {
    const response = await postLabSample(a, labSampleBody(a, { samplingTime: { date: "2026-09-10", time: "11:00" } }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.samplingTime).toBe(WRITE_SAMPLED_AT);
  });

  it("requires an Idempotency-Key, dry runs included, and previews without saving", async () => {
    const missing = await expectProblem(await postLabSample(a, labSampleBody(a), null), 400, "idempotency_key_required");
    expect(missing.code).toBe("idempotency_key_required");
    await expectProblem(await postLabSample(a, labSampleBody(a), null, "?dryRun=true"), 400, "idempotency_key_required");
    const preview = await postLabSample(a, labSampleBody(a), randomUUID(), "?dryRun=true");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("dry-run")).toBe("true");
    expect(preview.headers.has("etag")).toBe(false);
    expect(preview.headers.has("location")).toBe(false);
    const body = await preview.json();
    expect(body.data).toMatchObject({ version: 1, hToCOrgRatio: EXPECTED_H_TO_C, creditBatchId: a.batchA.id });
    expect(body.warnings[0]).toBe(H_TO_C_NOTICE);
    expect(body).not.toHaveProperty("stockEffects");
    await expectNoLabSampleWrite(a);
  });

  it("replays the same key and body byte for byte, and refuses the same key with another body", async () => {
    const key = randomUUID();
    const original = await postLabSample(a, labSampleBody(a), key);
    expect(original.status).toBe(201);
    const originalText = await original.text();
    const replay = await postLabSample(a, labSampleBody(a), key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe(original.headers.get("etag"));
    expect(replay.headers.get("location")).toBe(original.headers.get("location"));
    expect(await replay.text()).toBe(originalText);
    await expectProblem(await postLabSample(a, labSampleBody(a, { totalCarbonPercent: 81 }), key), 422, "idempotency_key_reused");
    expect(await labSampleRows(a)).toHaveLength(1);
    expect(await labSampleAudits(a)).toHaveLength(1);
    expect(await labIdempotencyRecords(a)).toHaveLength(1);
  });

  it("canonicalizes an uppercase credit batch id", async () => {
    const response = await postLabSample(a, uppercaseUuids(labSampleBody(a)));
    expect(response.status).toBe(201);
    expect((await response.json()).data.creditBatchId).toBe(a.batchA.id);
    // The same body in lowercase is the same request to the idempotency layer.
    const key = randomUUID();
    const first = await postLabSample(a, uppercaseUuids(labSampleBody(a, { labName: "Case Lab" })), key);
    const replay = await postLabSample(a, labSampleBody(a, { labName: "Case Lab" }), key);
    expect(first.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
  });

  it("answers 404 on /creditBatchId for an unknown, foreign or archived batch and saves nothing", async () => {
    await db.update(creditBatches).set({ archivedAt: new Date() }).where(and(eq(creditBatches.id, a.batchB!.id), eq(creditBatches.organizationId, a.ctx.organizationId)));
    for (const creditBatchId of [randomUUID(), b.batchA.id, a.batchB!.id]) {
      const refusal = await expectProblem(await postLabSample(a, labSampleBody(a, { creditBatchId, samplingTime: AUGUST_SAMPLED_AT })), 404, "not_found");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/creditBatchId", code: "not_found" }));
      expect(JSON.stringify(refusal)).not.toContain(b.batchA.code);
    }
    await expectNoLabSampleWrite(a);
    expect(await labSampleRows(b)).toEqual([]);
  });

  it.each([
    ["a time in the future", { samplingTime: FUTURE_AT }, "/samplingTime"],
    ["a time before the batch window", { samplingTime: BEFORE_WINDOW_AT }, "/samplingTime"],
    ["a time without an offset", { samplingTime: "2026-09-10T08:00:00" }, "/samplingTime"],
    ["organic carbon above total carbon", { organicCarbonPercent: 90 }, "/organicCarbonPercent"],
    ["a missing total carbon", { totalCarbonPercent: undefined }, "/totalCarbonPercent"],
    ["a percent above 100", { ashContentPercent: 101 }, "/ashContentPercent"],
    ["a ratio above the stored maximum", { totalHydrogenPercent: 99, organicCarbonPercent: 1 }, "/totalHydrogenPercent"],
  ])("answers 422 on its pointer for %s", async (_name, changes, pointer) => {
    const refusal = await expectProblem(await postLabSample(a, labSampleBody(a, changes)), 422, "validation_failed");
    expect(refusal.errors.map((error: { pointer: string }) => error.pointer)).toContain(pointer);
    await expectNoLabSampleWrite(a);
  });

  it("saves 1,000-year Samples without mean R₀ or TGA", async () => {
    const tier = await createApiLabFixture({ durabilityOption: "1000_year" });
    try {
      expect((await postLabSample(tier, labSampleBody(tier))).status).toBe(201);
    } finally { await removeApiLabFixture(tier); }
  });

  it.each(["hToCOrgRatio", "code", "durabilityOption", "nutrientClaimEnabled", "r0HistogramFileUrl", "arsenicMgKg", "productionRunId", "bogus"])(
    "rejects %s as an unknown key", async (key) => {
      const refusal = await expectProblem(await postLabSample(a, labSampleBody(a, { [key]: key === "code" ? "SAM-X" : 1 })), 422, "validation_failed");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${key}`, code: "unknown_field" }));
      await expectNoLabSampleWrite(a);
    });

  it("refuses a create into a batch whose lineage is in a certification", async () => {
    await assignRemoval(a, a.batchA, { submitted: true });
    const refusal = await expectProblem(await postLabSample(a, labSampleBody(a)), 409, "certification_locked");
    expect(refusal.detail).toContain(LINEAGE_LOCKED_COPY);
    await expectNoLabSampleWrite(a);
  });

  it("answers 403 before 404 for a key without the write scope", async () => {
    for (const key of [a.key, a.deleteKey, a.otherScopeKey]) {
      await expectProblem(await postLabSample(a, labSampleBody(a, { creditBatchId: b.batchA.id }), randomUUID(), "", key), 403, "missing_scope");
    }
    await expectNoLabSampleWrite(a);
  });

  it("does not let another organization's key reach this organization's batch", async () => {
    await expectProblem(await postLabSample(b, labSampleBody(a)), 404, "not_found");
    expect(await labSampleRows(a)).toEqual([]);
    expect(await labSampleRows(b)).toEqual([]);
  });
});

describe("lab sample update", { timeout: TIMEOUT_MS }, () => {
  it("changes fields with the next ETag, recalculates the ratio, and audits the changed fields only", async () => {
    const saved = await seedRestLabSample(a);
    const response = await patchLabSample(a, saved.row.id, { totalHydrogenPercent: 3, labName: "Edit Lab" }, saved.etag);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2.1"');
    const body = await response.json();
    expect(body.data).toMatchObject({ version: 2, labName: "Edit Lab", totalHydrogenPercent: 3, hToCOrgRatio: 0.4766 });
    expect(body.warnings[0]).toBe("H/C_org calculated from hydrogen and organic carbon: 0.4766");
    expect(await readRestLabSample(a, saved.row.id)).toEqual({ row: body.data, etag: '"2.1"' });
    const audit = (await labSampleAudits(a)).find((row) => row.operationId === "update_lab_sample");
    expect(audit).toMatchObject({
      outcomeCode: "updated", transport: "rest", credentialId: a.writeCredentialId, entityIds: [saved.row.id],
      versionBefore: 1, versionAfter: 2, changedFields: ["labName", "totalHydrogenPercent"],
    });
  });

  it("clears an optional field with null, and recalculates the ratio from the merged row", async () => {
    const saved = await seedRestLabSample(a);
    expect(saved.row.hToCOrgRatio).toBe(EXPECTED_H_TO_C);
    const response = await patchLabSample(a, saved.row.id, { totalHydrogenPercent: null, moistureContentPercent: null }, saved.etag);
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({ totalHydrogenPercent: null, moistureContentPercent: null, hToCOrgRatio: null });
    await expectProblem(await patchLabSample(a, saved.row.id, { totalCarbonPercent: null }, '"2.1"'), 422, "validation_failed");
  });

  it("renames the code and moves the sample to another credit batch", async () => {
    const saved = await seedRestLabSample(a);
    const renamed = await patchLabSample(a, saved.row.id, { code: "SAM-RENAMED-1" }, saved.etag);
    expect((await renamed.json()).data.code).toBe("SAM-RENAMED-1");
    const moved = await patchLabSample(a, saved.row.id, { creditBatchId: a.batchB!.id.toUpperCase(), samplingTime: AUGUST_SAMPLED_AT }, '"2.1"');
    expect(moved.status).toBe(200);
    expect((await moved.json()).data).toMatchObject({ creditBatchId: a.batchB!.id, version: 3, code: "SAM-RENAMED-1", samplingTime: AUGUST_SAMPLED_AT });
    expect(await labSampleRows(a)).toMatchObject([{ id: saved.row.id, creditBatchId: a.batchB!.id }]);
  });

  it("answers 404 on /creditBatchId for a move to a foreign or archived batch, with no side effect", async () => {
    const saved = await seedRestLabSample(a);
    await db.update(creditBatches).set({ archivedAt: new Date() }).where(and(eq(creditBatches.id, a.batchB!.id), eq(creditBatches.organizationId, a.ctx.organizationId)));
    for (const creditBatchId of [b.batchA.id, a.batchB!.id]) {
      const refusal = await expectProblem(await patchLabSample(a, saved.row.id, { creditBatchId, samplingTime: AUGUST_SAMPLED_AT }, saved.etag), 404, "not_found");
      expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/creditBatchId" }));
    }
    expect(await readRestLabSample(a, saved.row.id)).toEqual(saved);
    expect(await labSampleAudits(a)).toHaveLength(1);
  });

  it("answers 409 conflict for a duplicate code", async () => {
    const first = await seedRestLabSample(a);
    const second = await seedRestLabSample(a);
    const refusal = await expectProblem(await patchLabSample(a, second.row.id, { code: first.row.code }, second.etag), 409, "conflict");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: "/code" }));
    expect(await readRestLabSample(a, second.row.id)).toEqual(second);
  });

  it("requires If-Match and returns the current representation on a stale version or revision", async () => {
    const saved = await seedRestLabSample(a);
    await expectProblem(await patchLabSample(a, saved.row.id, {}), 428, "precondition_required");
    await expectProblem(await patchLabSample(a, saved.row.id, {}, "*"), 428, "strong_etag_required");
    const changed = await patchLabSample(a, saved.row.id, { labName: "First" }, saved.etag);
    const current = (await changed.json()).data;
    for (const tag of [saved.etag, '"2.99"']) {
      const refusal = await expectProblem(await patchLabSample(a, saved.row.id, { labName: "Second" }, tag), 412, "stale_version");
      expect(refusal.current).toEqual(current);
    }
    expect(requiredEtag(await patchLabSample(a, saved.row.id, {}, '"2.1"'))).toBe('"3.1"');
  });

  it("previews without persisting and without an ETag", async () => {
    const saved = await seedRestLabSample(a);
    const response = await patchLabSample(a, saved.row.id, { labName: "Preview" }, saved.etag, "?dryRun=true");
    expect(response.status).toBe(200);
    expect(response.headers.get("dry-run")).toBe("true");
    expect(response.headers.has("etag")).toBe(false);
    expect((await response.json()).data).toMatchObject({ labName: "Preview", version: 2 });
    expect(await db.select().from(samples).where(eq(samples.id, saved.row.id))).toMatchObject([{ labName: null, version: 1 }]);
  });

  it("canonicalizes an uppercase path id, and rejects a code, an unknown id and another organization's id with 404", async () => {
    const saved = await seedRestLabSample(a);
    const other = await seedRestLabSample(b);
    const upper = await patchLabSample(a, saved.row.id.toUpperCase(), { labName: "Upper" }, saved.etag);
    expect(upper.status).toBe(200);
    for (const id of [saved.row.code, randomUUID(), other.row.id]) {
      await expectProblem(await patchLabSample(a, id, { labName: "No" }, '"1.1"'), 404, "not_found");
    }
    expect((await readRestLabSample(b, other.row.id)).etag).toBe(other.etag);
  });

  it.each(["labSampleId", "expectedVersion", "hToCOrgRatio", "durabilityOption", "productionRunId", "bogus"])("rejects %s as an unknown key", async (key) => {
    const saved = await seedRestLabSample(a);
    const refusal = await expectProblem(await patchLabSample(a, saved.row.id, { [key]: 1 }, saved.etag), 422, "validation_failed");
    expect(refusal.errors).toContainEqual(expect.objectContaining({ pointer: `/${key}`, code: "unknown_field" }));
    expect((await readRestLabSample(a, saved.row.id)).etag).toBe(saved.etag);
  });

  it("refuses a PATCH on a sample whose lineage is in a certification", async () => {
    const saved = await seedRestLabSample(a);
    await assignRemoval(a, a.batchA, { submitted: true });
    const refusal = await expectProblem(await patchLabSample(a, saved.row.id, { labName: "Locked" }, saved.etag), 409, "certification_locked");
    expect(refusal.detail).toContain(LINEAGE_LOCKED_COPY);
    expect(await readRestLabSample(a, saved.row.id)).toEqual(saved);
  });

  it("answers 403 before 404 and 412, and the delete scope cannot write", async () => {
    const saved = await seedRestLabSample(a);
    for (const key of [a.key, a.deleteKey]) {
      await expectProblem(await patchLabSample(a, randomUUID(), { labName: "No" }, '"9.1"', "", {}, key), 403, "missing_scope");
      await expectProblem(await patchLabSample(a, saved.row.id, { labName: "No" }, '"9.1"', "", {}, key), 403, "missing_scope");
    }
    expect(await readRestLabSample(a, saved.row.id)).toEqual(saved);
  });
});

describe("lab sample keyed replays", { timeout: TIMEOUT_MS }, () => {
  const keyed = (key: string) => ({ "idempotency-key": key });

  it("replays a keyed PATCH with its original status, body, ETag and headers, and writes nothing more", async () => {
    const saved = await seedRestLabSample(a);
    const key = randomUUID();
    const original = await patchLabSample(a, saved.row.id, { labName: "Keyed" }, saved.etag, "", keyed(key));
    expect(original.status).toBe(200);
    const originalText = await original.text();
    const replay = await patchLabSample(a, saved.row.id, { labName: "Keyed" }, saved.etag, "", keyed(key));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe('"2.1"');
    expect(await replay.text()).toBe(originalText);
    expect(await labSampleRows(a)).toMatchObject([{ version: 2, labName: "Keyed" }]);
    expect(await labSampleAudits(a)).toHaveLength(2);
  });

  it("still replays after the sample was edited again, without touching the newer row", async () => {
    const saved = await seedRestLabSample(a);
    const key = randomUUID();
    const original = await patchLabSample(a, saved.row.id, { labName: "First" }, saved.etag, "", keyed(key));
    const originalText = await original.text();
    expect((await patchLabSample(a, saved.row.id, { labName: "Second" }, '"2.1"')).status).toBe(200);
    const replay = await patchLabSample(a, saved.row.id, { labName: "First" }, saved.etag, "", keyed(key));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.headers.get("etag")).toBe('"2.1"');
    expect(await replay.text()).toBe(originalText);
    expect(await labSampleRows(a)).toMatchObject([{ version: 3, labName: "Second" }]);
    expect(await labSampleAudits(a)).toHaveLength(3);
  });

  it("refuses a key reused with another body, another target or another precondition", async () => {
    const first = await seedRestLabSample(a);
    const second = await seedRestLabSample(a);
    const key = randomUUID();
    expect((await patchLabSample(a, first.row.id, { labName: "One" }, first.etag, "", keyed(key))).status).toBe(200);
    await expectProblem(await patchLabSample(a, first.row.id, { labName: "Other" }, first.etag, "", keyed(key)), 422, "idempotency_key_reused");
    await expectProblem(await patchLabSample(a, second.row.id, { labName: "One" }, second.etag, "", keyed(key)), 422, "idempotency_key_reused");
    expect(await labSampleRows(a)).toMatchObject(expect.arrayContaining([expect.objectContaining({ id: second.row.id, version: 1, labName: null })]));
    expect(await labSampleAudits(a)).toHaveLength(3);
  });

  it("replays a keyed DELETE as 204 after the sample is gone, without a second audit row", async () => {
    const saved = await seedRestLabSample(a);
    const key = randomUUID();
    const original = await deleteLabSample(a, saved.row.id, saved.etag, "", undefined, a.deleteKey, keyed(key));
    expect(original.status).toBe(204);
    const replay = await deleteLabSample(a, saved.row.id, saved.etag, "", undefined, a.deleteKey, keyed(key));
    expect(replay.status).toBe(204);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await replay.text()).toBe("");
    expect(await labSampleRows(a)).toEqual([]);
    expect((await labSampleAudits(a)).filter((row) => row.operationId === "delete_lab_sample")).toHaveLength(1);
  });

  it("isolates one key across credentials and organizations", async () => {
    const key = randomUUID();
    const first = await postLabSample(a, labSampleBody(a), key);
    const otherCredential = await postLabSample(a, labSampleBody(a), key, "", a.writeOnlyKey);
    const otherOrganization = await postLabSample(b, labSampleBody(b), key);
    for (const response of [first, otherCredential, otherOrganization]) {
      expect(response.status).toBe(201);
      expect(response.headers.has("idempotent-replayed")).toBe(false);
    }
    expect(await labSampleRows(a)).toHaveLength(2);
    expect(await labSampleRows(b)).toHaveLength(1);
    const replay = await postLabSample(a, labSampleBody(a), key);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(await labSampleRows(a)).toHaveLength(2);
  });
});

describe("lab sample delete", { timeout: TIMEOUT_MS }, () => {
  it("deletes with the delete scope, an optional empty body and one audit row", async () => {
    const saved = await seedRestLabSample(a);
    const response = await deleteLabSample(a, saved.row.id, saved.etag);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await labSampleRows(a)).toEqual([]);
    expect((await labSampleAudits(a)).find((row) => row.operationId === "delete_lab_sample")).toMatchObject({
      outcomeCode: "deleted", transport: "rest", entityIds: [saved.row.id], versionBefore: 1, versionAfter: null,
    });
    const again = await seedRestLabSample(a);
    expect((await deleteLabSample(a, again.row.id, again.etag, "", {})).status).toBe(204);
  });

  it("refuses the write scope, a body with content, and a missing or stale If-Match", async () => {
    const saved = await seedRestLabSample(a);
    await expectProblem(await deleteLabSample(a, saved.row.id, saved.etag, "", undefined, a.writeKey), 403, "missing_scope");
    await expectProblem(await deleteLabSample(a, saved.row.id), 428, "precondition_required");
    await expectProblem(await deleteLabSample(a, saved.row.id, saved.etag, "", { force: true }), 422, "validation_failed");
    const changed = await patchLabSample(a, saved.row.id, { labName: "Edit" }, saved.etag);
    const current = (await changed.json()).data;
    expect((await expectProblem(await deleteLabSample(a, saved.row.id, saved.etag), 412, "stale_version")).current).toEqual(current);
    expect(await labSampleRows(a)).toHaveLength(1);
  });

  it("previews the deletion without removing the sample", async () => {
    const saved = await seedRestLabSample(a);
    const response = await deleteLabSample(a, saved.row.id, saved.etag, "?dryRun=true");
    expect(response.status).toBe(200);
    expect(response.headers.get("dry-run")).toBe("true");
    expect((await response.json()).data).toEqual(saved.row);
    expect(await labSampleRows(a)).toHaveLength(1);
  });

  it("answers 404 for a code, an unknown id and another organization's id, and 409 once certified", async () => {
    const saved = await seedRestLabSample(a);
    const other = await seedRestLabSample(b);
    for (const id of [saved.row.code, randomUUID(), other.row.id]) await expectProblem(await deleteLabSample(a, id, '"1.1"'), 404, "not_found");
    expect(await labSampleRows(b)).toHaveLength(1);
    await assignRemoval(a, a.batchA, { submitted: true });
    await expectProblem(await deleteLabSample(a, saved.row.id, saved.etag), 409, "certification_locked");
    expect(await labSampleRows(a)).toHaveLength(1);
  });

  it("answers 403 before 404 for a key without the delete scope", async () => {
    for (const key of [a.key, a.writeKey]) await expectProblem(await deleteLabSample(a, randomUUID(), '"1.1"', "", undefined, key), 403, "missing_scope");
  });
});
