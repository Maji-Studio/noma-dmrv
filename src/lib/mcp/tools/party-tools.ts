import { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation, type Operation } from "@/lib/operations/runner";
import { controls, parseControls, writeOptions } from "./write-controls";
import type { WriteTool } from "./write-tools";
import { partyToolDescription, partyToolSummary, locationToolDescription, locationToolSummary, type LocationCommand } from "./party-tool-guidance";
import { CUSTOMER_LOCATION_REPRESENTATION_REVISION, SUPPLIER_LOCATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import * as customerLocationWrites from "@/lib/api/customer-location-write-operations";
import * as supplierLocationWrites from "@/lib/api/supplier-location-write-operations";
import { withCurrentOnStale } from "@/lib/api/write-checks";
import { partyLocationNotFound } from "@/lib/party-domain-errors";
import { readApiCustomerLocation } from "@/lib/read-models/api-customer-locations";
import { readApiSupplierLocation } from "@/lib/read-models/api-supplier-locations";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import * as locationOperations from "@/lib/operations/party-location-api";

import { deleteCustomerApi } from "@/lib/operations/customer-api";
import { representationCheckedCascadeDelete } from "@/lib/api/customer-write-operations";
import { runWithCascadePreview } from "@/lib/operations/cascade-preview";
import { cascadePreviewSchema } from "@/lib/api/problem-schema";

type PartyRow = { id: string; code: string; version: number };
const commands = ["create", "update", "delete", "archive", "restore"] as const;

/** Shared party transport; each adapter supplies its REST operations and contracts. */
export function partyWriteTools<
  Kind extends "supplier" | "customer",
  Id extends `${Kind}Id`,
  Create extends z.ZodObject,
  Update extends z.ZodObject,
  Version extends z.ZodObject & z.ZodType<Record<Id, string> & { expectedVersion: number }>,
  Row extends PartyRow,
  Location,
>(kind: Kind, deps: {
  idKey: Id;
  revision: number;
  create: Operation<Create, Record<Kind, NoInfer<Row>> & { locations: Location[] }>;
  updateInput: Update;
  versionInput: Version;
  representation: z.ZodType<Row>;
  locationRepresentation: z.ZodType<Location>;
  checkedUpdate: (id: string, revision: number) => Operation<Update, Record<Kind, NoInfer<Row>>>;
  checkedDelete?: (id: string, revision: number) => Operation<Version, NoInfer<Row>>;
  checkedTransition: (id: string, revision: number, command: "archive" | "restore") => Operation<Version, Record<Kind, NoInfer<Row>>>;
  withCurrentOnStale: <T>(ctx: ApiContext, id: string, fn: () => Promise<T>) => Promise<T>;
}): WriteTool[] {
  const createOutput = z.object({ data: deps.representation, locations: z.array(deps.locationRepresentation) });
  const itemOutput = z.object({ data: deps.representation });
  const deleteOutput = kind === "customer"
    ? itemOutput.extend({ cascade: cascadePreviewSchema, warnings: z.array(z.string()).optional() })
    : z.union([itemOutput, z.object({ deleted: z.object({ id: z.uuid(), code: z.string() }) })]);

  const tools: WriteTool[] = commands.map(command => {
    const schema = command === "delete" && kind === "customer" ? deleteCustomerApi.input : command === "create" ? deps.create.input : command === "update" ? deps.updateInput : deps.versionInput;
    const inputSchema = schema.safeExtend(controls.shape);
    const contract = toOperationJsonSchema(inputSchema);
    return {
      kind: "write", name: `${command}_${kind}`, scope: command === "delete" ? `${kind}s:delete` : `${kind}s:write`,
      input: inputSchema, output: command === "create" ? createOutput : command === "delete" ? deleteOutput : itemOutput,
      annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true, destructiveHint: command !== "create" },
      description: partyToolDescription(kind, command),
      async execute(context, raw) {
        const { input, dryRun, requestKey } = parseControls(raw, contract);
        if (command === "create") {
          const result = await runOperation(deps.create, context.ctx, input, writeOptions(context, dryRun, requestKey));
          const data = z.object({ [kind]: deps.representation, locations: z.array(deps.locationRepresentation) }).parse(result.data);
          return { ...result, body: createOutput.parse({ data: data[kind], locations: data.locations }) };
        }
        const parsed = schema.safeParse(input);
        if (!parsed.success) throw validationFailed(parsed.error);
        const version = deps.versionInput.parse({ [deps.idKey]: (parsed.data as Record<string, unknown>)[deps.idKey], expectedVersion: parsed.data.expectedVersion });
        const id = version[deps.idKey];
        const { expectedVersion } = version;
        const options = writeOptions(context, dryRun, requestKey, id, expectedVersion, deps.revision);
        return deps.withCurrentOnStale(context.ctx, id, async () => {
          if (command === "delete") {
            if (kind === "customer") {
              const result = await runWithCascadePreview(representationCheckedCascadeDelete(id, deps.revision), context.ctx, input, options);
              const { customer, cascade, warnings } = result.data;
              return { ...result, body: deleteOutput.parse({ data: customer, cascade, ...(warnings.length ? { warnings } : {}) }) };
            }
            const result = await runOperation(deps.checkedDelete!(id, deps.revision), context.ctx, input, options);
            return { ...result, body: dryRun ? { data: deps.representation.parse(result.data) } : { deleted: { id: result.data.id, code: result.data.code } } };
          }
          const result = command === "update"
            ? await runOperation(deps.checkedUpdate(id, deps.revision), context.ctx, input, options)
            : await runOperation(deps.checkedTransition(id, deps.revision, command), context.ctx, input, options);
          const data = z.object({ [kind]: deps.representation }).parse(result.data);
          return { ...result, body: { data: data[kind] } };
        });
      },
      summarize(body, dryRun) {
        const row = (body.data ?? body.deleted) as PartyRow;
        return partyToolSummary(kind, command, row, dryRun);
      },
    };
  });
  if (kind === "supplier") {
    const revision = SUPPLIER_LOCATION_REPRESENTATION_REVISION;
    const schema = supplierLocationRepresentationSchema;
    tools.push(
      locationCommand(kind, "add", locationOperations.addSupplierLocationApi, schema, revision),
      locationCommand(kind, "update", locationOperations.updateSupplierLocationApi, schema, revision,
        (parentId, id) => supplierLocationWrites.representationCheckedUpdate(parentId, id, revision)),
      locationCommand(kind, "delete", locationOperations.deleteSupplierLocationApi, schema, revision,
        (parentId, id) => supplierLocationWrites.representationCheckedDelete(parentId, id, revision)),
    );
  } else {
    const revision = CUSTOMER_LOCATION_REPRESENTATION_REVISION;
    const schema = customerLocationRepresentationSchema;
    tools.push(
      locationCommand(kind, "add", locationOperations.addCustomerLocationApi, schema, revision),
      locationCommand(kind, "update", locationOperations.updateCustomerLocationApi, schema, revision,
        (parentId, id) => customerLocationWrites.representationCheckedUpdate(parentId, id, revision)),
      locationCommand(kind, "delete", locationOperations.deleteCustomerLocationApi, schema, revision,
        (parentId, id) => customerLocationWrites.representationCheckedDelete(parentId, id, revision)),
      locationCommand(kind, "archive", locationOperations.archiveCustomerLocationApi, schema, revision,
        (parentId, id) => customerLocationWrites.representationCheckedTransition(parentId, id, revision, "archive")),
      locationCommand(kind, "restore", locationOperations.restoreCustomerLocationApi, schema, revision,
        (parentId, id) => customerLocationWrites.representationCheckedTransition(parentId, id, revision, "restore")),
    );
  }
  return tools;
}

function locationCommand<Input extends z.ZodObject, Row extends { id: string; version: number }>(
  kind: "supplier" | "customer", command: LocationCommand,
  operation: Operation<Input, { data: Row; warnings: string[] }>, representation: z.ZodType<Row>, revision: number,
  checked?: (parentId: string, locationId: string) => Operation<Input, { data: Row; warnings: string[] }>,
): WriteTool {
  const inputSchema = operation.input.safeExtend(controls.shape);
  const contract = toOperationJsonSchema(inputSchema);
  const output = z.object({ data: representation, warnings: z.array(z.string()).optional() });
  return {
    kind: "write", name: operation.id, scope: command === "delete" ? `${kind}s:delete` : `${kind}s:write`,
    input: inputSchema, output,
    annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true, destructiveHint: command !== "add" },
    description: locationToolDescription(kind, command),
    async execute(context, raw) {
      const { input, dryRun, requestKey } = parseControls(raw, contract);
      const parsed = operation.input.safeParse(input);
      if (!parsed.success) throw validationFailed(parsed.error);
      const fields = parsed.data as Record<string, unknown>;
      const parentId = fields[`${kind}Id`] as string;
      const locationId = fields.locationId as string | undefined;
      const options = writeOptions(context, dryRun, requestKey, locationId, fields.expectedVersion as number | undefined, revision);
      return withCurrentOnStale(async () => {
        const result = await runOperation(checked ? checked(parentId, locationId!) : operation, context.ctx, input, options);
        const saved = z.object({ data: representation, warnings: z.array(z.string()) }).parse(result.data);
        return { ...result, body: output.parse({ data: saved.data,
          ...(saved.warnings.length ? { warnings: saved.warnings } : {}) }) };
      }, { noun: `${kind} location`, readCurrent: async () => {
        const current = kind === "supplier"
          ? await readApiSupplierLocation(context.ctx, parentId, locationId!)
          : await readApiCustomerLocation(context.ctx, parentId, locationId!);
        if (!current) throw partyLocationNotFound(kind);
        return current;
      } });
    },
    summarize: (body, dryRun) => locationToolSummary(kind, command, body.data as Row, dryRun),
  };
}
