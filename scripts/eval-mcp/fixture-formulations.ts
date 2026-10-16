import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes, formulationIngredients, formulations, members, orders, users } from "@/db/schema";
import { createApiKey } from "@/data-access/api-keys";
import { createCustomer, createCustomerLocation } from "@/data-access/customers";
import { createFeedstockType } from "@/data-access/feedstock-types";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { runOperationInProcess } from "@/lib/operations/runner";
import { archiveFormulation, createFormulation } from "@/lib/operations/formulations";
import { recordOrder } from "@/lib/operations/orders";
import { createIntakeFixture, type IntakeFixture } from "../../tests/helpers/operation-fixture";
import { TEST_SITE_POSITION } from "../../tests/helpers/test-org";
import { FORMULATION_CASES, type FormulationCaseId } from "./config";
import { cleanupDeliveryFixture } from "./fixture-delivery";
import type { FormulationSnapshot, FormulationTarget } from "./score-formulations";

const PURE_BIOCHAR_RATIO = 1;
const ORDER_QUANTITY_KG = 500;
const ORDER_DATE = "2026-10-15";
const scriptOptions = { activitySource: "script" as const };
export interface FormulationEvalFixture extends IntakeFixture { key: string; target: FormulationTarget }

export async function seedFormulationFixture(caseId: FormulationCaseId): Promise<FormulationEvalFixture> {
  const fixture = await db.transaction((tx) => createIntakeFixture(`eval-${caseId}-${randomUUID()}`, tx));
  const { ctx } = fixture;
  try {
    await db.insert(users).values({ id: ctx.userId, email: `${ctx.userId}@example.test`, name: "MCP evaluation", emailVerified: true });
    await db.insert(members).values({ id: randomUUID(), organizationId: ctx.organizationId, userId: ctx.userId, role: "owner" });
    const compost = await createFeedstockType(ctx, { code: "COMPOST", name: "Compost", category: "compost", usage: "blend" });
    const formulation = await runOperationInProcess(createFormulation, ctx, { name: "Evaluation pure biochar", biocharRatio: PURE_BIOCHAR_RATIO }, scriptOptions);
    await runOperationInProcess(createFormulation, ctx, { name: "Other formulation", biocharRatio: PURE_BIOCHAR_RATIO }, scriptOptions);
    // Only an order references this row: no product or bin can mask the order guard.
    if (caseId === "formulation-guarded-delete") {
      const customer = await createCustomer(ctx, { code: "CUS-EVAL", name: "Evaluation customer" });
      const location = await createCustomerLocation(ctx, { ...TEST_SITE_POSITION, customerId: customer.id, name: "Evaluation field", isDefault: true });
      await runOperationInProcess(recordOrder, ctx, {
        facilityId: fixture.facilityId, customerId: customer.id, customerLocationId: location.id,
        formulationId: formulation.id, orderDate: ORDER_DATE, quantityKg: ORDER_QUANTITY_KG, packaging: "loose",
      }, scriptOptions);
    }
    if (caseId === "formulation-restore") {
      await runOperationInProcess(archiveFormulation, ctx, { formulationId: formulation.id, expectedVersion: formulation.version }, scriptOptions);
    }
    const definition = FORMULATION_CASES.find(({ id }) => id === caseId)!;
    const credential = await createApiKey(ctx, { name: "MCP evaluation", scopes: [...definition.scopes], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS });
    return { ...fixture, key: credential.key, target: {
      formulationId: formulation.id, code: formulation.code, compostTypeId: compost.id, before: await readFormulationSnapshot(fixture),
    } };
  } catch (error) {
    await cleanupFormulationFixture(fixture);
    throw error;
  }
}

/** Read every row in the isolated organization, including full parent and line facts. */
export async function readFormulationSnapshot({ ctx }: IntakeFixture): Promise<FormulationSnapshot> {
  const rows = await db.select().from(formulations).where(eq(formulations.organizationId, ctx.organizationId)).orderBy(formulations.id);
  const lines = await db.select().from(formulationIngredients).where(eq(formulationIngredients.organizationId, ctx.organizationId)).orderBy(formulationIngredients.id);
  const types = await db.select().from(feedstockTypes).where(eq(feedstockTypes.organizationId, ctx.organizationId)).orderBy(feedstockTypes.id);
  const orderRows = await db.select().from(orders).where(eq(orders.organizationId, ctx.organizationId)).orderBy(orders.id);
  return {
    formulations: rows.map((row) => ({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
    lines: lines.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    feedstockTypes: types, orders: orderRows,
  };
}

export const cleanupFormulationFixture = cleanupDeliveryFixture;
