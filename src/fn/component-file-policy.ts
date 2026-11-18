"use server";

import { setComponentFilePolicy } from "@/data-access/component-file-policy";
import { setComponentFilePolicySchema } from "@/schemas/component-file-policy";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

export async function setComponentFilePolicyFn(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof setComponentFilePolicy>>>> {
  return withAction(ctx => setComponentFilePolicy(ctx, setComponentFilePolicySchema.parse(input)));
}
