import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema/auth";
import { removalTemplateObservations as observations, type RemovalTemplateObservation } from "@/db/schema/certification";
import type { OrgContext } from "@/lib/auth/server";
import { canonicalJson } from "@/lib/canonical-json";
import { SafeError } from "@/lib/errors";
import {
  fullFingerprint, isEnrichmentComplete, normalizeTemplateDefinition, resolveLineSources,
  semanticFingerprint, validateLineSources,
  type GhgEntryTemplate, type LineContract, type TemplateEnrichment,
} from "@/lib/isometric/template-observations";
import { assertRowVersion, nextVersion, staleRowVersion } from "./row-version";
import { requireOrgScope } from "./utils";

const OBSERVATION_ORDER_TICK_MS = 1;

export async function getLatestTemplateObservation(ctx: OrgContext, provider: string, externalTemplateId: string): Promise<RemovalTemplateObservation | null> {
  requireOrgScope(ctx);
  const [row] = await db.select().from(observations).where(and(
    eq(observations.organizationId, ctx.organizationId), eq(observations.provider, provider),
    eq(observations.externalTemplateId, externalTemplateId),
  )).orderBy(desc(observations.lastObservedAt), desc(observations.id)).limit(1);
  return row ?? null;
}

export async function getTemplateObservationById(ctx: OrgContext, id: string): Promise<RemovalTemplateObservation | null> {
  requireOrgScope(ctx);
  const [row] = await db.select().from(observations).where(and(
    eq(observations.organizationId, ctx.organizationId), eq(observations.id, id),
  )).limit(1);
  return row ?? null;
}

export async function getPreviousTemplateObservation(ctx: OrgContext, provider: string, externalTemplateId: string, id: string): Promise<RemovalTemplateObservation | null> {
  requireOrgScope(ctx);
  const [row] = await db.select().from(observations).where(and(
    eq(observations.organizationId, ctx.organizationId), eq(observations.provider, provider),
    eq(observations.externalTemplateId, externalTemplateId), ne(observations.id, id),
  )).orderBy(desc(observations.lastObservedAt), desc(observations.id)).limit(1);
  return row ?? null;
}

export async function observeTemplate(ctx: OrgContext, input: {
  provider: string; externalProjectId: string; template: GhgEntryTemplate; enrichment: TemplateEnrichment;
  /** True when `enrichment` was copied from a stored observation rather than read from the registry. */
  enrichmentReused?: boolean;
}) {
  requireOrgScope(ctx);
  const definition = normalizeTemplateDefinition(input.template);
  const semantic = semanticFingerprint(definition, input.enrichment);
  const full = fullFingerprint(definition, input.enrichment);
  return db.transaction(async (tx) => {
    // Serialize first observations too, when no template row exists to lock.
    // Reviews take the same organization lock before locking their observation.
    await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, ctx.organizationId)).for("update");
    const templateScope = and(
      eq(observations.organizationId, ctx.organizationId), eq(observations.provider, input.provider),
      eq(observations.externalTemplateId, input.template.id),
    );
    const [latest] = await tx.select().from(observations).where(templateScope)
      .orderBy(desc(observations.lastObservedAt), desc(observations.id)).limit(1);
    const [existing] = await tx.select().from(observations).where(and(templateScope,
      eq(observations.semanticFingerprint, semantic), eq(observations.fullFingerprint, full),
    )).limit(1);
    const lineSources = existing && latest?.id === existing.id ? existing.lineSources
      : resolveLineSources({ definition, previous: latest });
    const sourcesChanged = existing && canonicalJson(existing.lineSources) !== canonicalJson(lineSources);
    const now = new Date(Math.max(Date.now(), (latest?.lastObservedAt.getTime() ?? 0) + OBSERVATION_ORDER_TICK_MS));
    const [row] = await tx.insert(observations).values({
      organizationId: ctx.organizationId, provider: input.provider, externalProjectId: input.externalProjectId,
      externalTemplateId: input.template.id, semanticFingerprint: semantic, fullFingerprint: full,
      definition, enrichment: input.enrichment, lineSources, lastObservedAt: now, enrichedAt: now,
    }).onConflictDoUpdate({
      target: [observations.organizationId, observations.provider, observations.externalTemplateId,
        observations.semanticFingerprint, observations.fullFingerprint],
      set: {
        lastObservedAt: now,
        ...(input.enrichmentReused ? {} : { enrichedAt: now }),
        ...(sourcesChanged ? { lineSources, version: nextVersion(observations.version), updatedAt: now } : {}),
      },
    }).returning();
    return row;
  });
}

export interface ReviewLineContractsInput {
  observationId: string;
  expectedVersion: number;
  assignments: Record<string, Pick<LineContract, "scope" | "automaticSource" | "entryPolicy">>;
}

export async function reviewLineContracts(ctx: OrgContext, input: ReviewLineContractsInput) {
  requireOrgScope(ctx);
  return db.transaction(async (tx) => {
    await tx.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.id, ctx.organizationId)).for("update");
    const [row] = await tx.select().from(observations).where(and(
      eq(observations.organizationId, ctx.organizationId), eq(observations.id, input.observationId),
    )).for("update");
    if (!row) throw new SafeError("Removal template observation not found.");
    assertRowVersion({ entity: "removal_template_observation", id: row.id, expectedVersion: input.expectedVersion, actualVersion: row.version });
    // Compilation reads the latest observation; a review of a superseded one would never apply.
    const [latest] = await tx.select({ id: observations.id }).from(observations).where(and(
      eq(observations.organizationId, ctx.organizationId), eq(observations.provider, row.provider),
      eq(observations.externalTemplateId, row.externalTemplateId),
    )).orderBy(desc(observations.lastObservedAt), desc(observations.id)).limit(1);
    if (latest?.id !== row.id) throw staleRowVersion("removal_template_observation", row.id);
    if (!isEnrichmentComplete(row.definition, row.enrichment)) throw new SafeError("Template not fully read. Try again.");
    const componentIds = new Set(row.definition.groups.flatMap((group) => group.components.map((component) => component.id)));
    const lineSources = { ...row.lineSources };
    for (const [id, assignment] of Object.entries(input.assignments)) {
      if (!componentIds.has(id)) throw new SafeError("Template line not found.");
      if (assignment.scope !== "operating" && (assignment.automaticSource || assignment.entryPolicy !== "none")) {
        throw new SafeError("Only operating lines can use automatic sources or entries.");
      }
      lineSources[id] = { ...assignment, origin: "reviewed" };
    }
    const problems = validateLineSources(row.definition, lineSources).filter((problem) => problem.code !== "unassigned");
    if (problems.length) throw new SafeError("Choose valid, distinct sources and entry policies for the Removal template lines.");
    const [reviewed] = await tx.update(observations).set({
      lineSources, reviewedAt: new Date(), reviewedByUserId: ctx.userId,
      version: nextVersion(observations.version), updatedAt: new Date(),
    }).where(and(eq(observations.organizationId, ctx.organizationId), eq(observations.id, row.id))).returning();
    return reviewed;
  });
}
