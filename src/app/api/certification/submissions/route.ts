import { z } from "zod";
import { requireOrgContext, requireOrgRole } from "@/lib/auth/server";
import { SafeError, toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit/in-memory";
import {
  submitGhgStatementDialogSchema,
  submitRemovalSchema,
} from "@/schemas/certification";
import { logActionError } from "@/fn/action-errors";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { submitGhgStatementToVerifierCore } from "@/fn/certification/submit-ghg-statement";
import { submitRateLimit } from "@/fn/certification/shared";
import type {
  SubmissionProgressStreamEvent,
  SubmissionProgressUpdate,
} from "@/lib/certification/submission-progress";

export const runtime = "nodejs";

const progressRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("removal"), input: submitRemovalSchema }),
  z.object({
    kind: z.literal("ghg_statement"),
    ghgStatementId: z.string().uuid(),
    input: submitGhgStatementDialogSchema,
  }),
]);

type StreamEvent = SubmissionProgressStreamEvent<unknown>;

function assertSubmitRateLimit(args: {
  key: string;
  userId: string;
}): void {
  const rateLimit = submitRateLimit(args.key);
  const verdict = checkRateLimit({
    key: `${rateLimit.key}:${args.userId}`,
    max: rateLimit.max,
    windowMs: rateLimit.windowMs,
  });
  if (!verdict.allowed) {
    throw new SafeError(
      `Too many attempts. Try again in ${verdict.retryAfterSeconds}s.`,
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  let streamOpen = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        if (!streamOpen) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser disconnected. The submit core must keep running so a
          // confirmed registry write can still be journaled and reconciled.
          streamOpen = false;
        }
      };
      const onProgress = (update: SubmissionProgressUpdate) => {
        send({ type: "progress", update });
      };

      void (async () => {
        try {
          const orgCtx = await requireOrgContext();
          requireOrgRole(orgCtx, "admin");
          const body = progressRequestSchema.parse(await request.json());
          const key =
            body.kind === "removal"
              ? "cert:submit-removal"
              : "cert:submit-ghg-statement";
          assertSubmitRateLimit({ key, userId: orgCtx.userId });

          const result =
            body.kind === "removal"
              ? await submitRemoval({
                  orgCtx,
                  removalId: body.input.removalId,
                  confirmProduction: body.input.confirmProduction,
                  expectedCompilationHash: body.input.compilationHash,
                  onProgress,
                })
              : await submitGhgStatementToVerifierCore({
                  orgCtx,
                  ghgStatementId: body.ghgStatementId,
                  input: body.input,
                  onProgress,
                });
          send({ type: "result", result });
        } catch (error) {
          const message =
            error instanceof z.ZodError
              ? `Validation error: ${error.issues.map((issue) => issue.message).join(", ")}`
              : toActionError(
                  error,
                  "The submission could not be completed. Try again.",
                );
          logActionError(error, {
            message: "submission progress stream failed",
          });
          send({ type: "error", error: message });
        } finally {
          if (streamOpen) {
            controller.close();
            streamOpen = false;
          }
        }
      })();
    },
    cancel() {
      // Do not cancel the submit core. Its idempotency and audit work must run
      // to completion even if the operator loses the response connection.
      streamOpen = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
