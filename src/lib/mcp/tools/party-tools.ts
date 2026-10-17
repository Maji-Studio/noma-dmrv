import { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { validationFailed } from "@/lib/operations/errors";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { runOperation, type Operation } from "@/lib/operations/runner";
import { controls, parseControls, writeOptions } from "./write-controls";
import type { WriteTool } from "./write-tools";
import { partyToolDescription, partyToolSummary } from "./party-tool-guidance";

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

  return commands.map(command => {
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
}
