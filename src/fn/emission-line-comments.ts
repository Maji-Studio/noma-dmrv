"use server";

import type { z } from "zod";
import { withAction } from "./with-action";
import { setEmissionLineComment, deleteEmissionLineComment } from "@/data-access/emission-line-comments";
import { setEmissionLineCommentActionSchema, deleteEmissionLineCommentActionSchema } from "@/schemas/emission-line-comments";
import type { ActionResult } from "@/types/actions";

export async function setEmissionLineCommentFn(
  input: z.input<typeof setEmissionLineCommentActionSchema>,
): Promise<ActionResult<Awaited<ReturnType<typeof setEmissionLineComment>>>> {
  return withAction((ctx) => setEmissionLineComment(ctx, setEmissionLineCommentActionSchema.parse(input)));
}

export async function deleteEmissionLineCommentFn(
  input: z.input<typeof deleteEmissionLineCommentActionSchema>,
): Promise<ActionResult<{ id: string }>> {
  return withAction((ctx) => deleteEmissionLineComment(ctx, deleteEmissionLineCommentActionSchema.parse(input)));
}
