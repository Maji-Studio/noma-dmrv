import { z } from "zod";
import { requireOrgContext, requireOrgRole } from "@/lib/auth/server";
import { SafeError, toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit/in-memory";
import { SUBMISSION_STREAM_PING_INTERVAL_MS } from "@/lib/certification/submission-progress";
import {
  submitGhgStatementDialogSchema,
  submitRemovalSchema,
} from "@/schemas/certification";
import { logActionError } from "@/fn/action-errors";
import { submitRemoval } from "@/fn/certification/submit-removal";
import { submitGhgStatementToVerifierCore } from "@/fn/certification/submit-ghg-statement";
import { submitRateLimit } from "@/fn/certification/shared";
import type { OrgContext } from "@/lib/auth/server";
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
type ProgressRequest = z.infer<typeof progressRequestSchema>;

function checkSubmitRateLimit(args: {
  key: string;
  userId: string;
}) {
  const rateLimit = submitRateLimit(args.key);
  return checkRateLimit({
    key: `${rateLimit.key}:${args.userId}`,
    max: rateLimit.max,
    windowMs: rateLimit.windowMs,
  });
}

function admissionError(error: string, status: number, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  let orgCtx: OrgContext;
  try {
    orgCtx = await requireOrgContext();
    requireOrgRole(orgCtx, "admin");
  } catch (error) {
    logActionError(error, { message: "submission stream access denied" });
    return admissionError(
      error instanceof SafeError ? error.message : "Access denied.",
      error instanceof SafeError ? 403 : 500,
    );
  }

  let body: ProgressRequest;
  try {
    body = progressRequestSchema.parse(await request.json());
  } catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof SyntaxError)) {
      logActionError(error, { message: "submission request parsing failed" });
    }
    return admissionError("Invalid submission request.", 400);
  }

  const rateLimitKey =
    body.kind === "removal"
      ? "cert:submit-removal"
      : "cert:submit-ghg-statement";
  const rateLimitVerdict = checkSubmitRateLimit({
    key: rateLimitKey,
    userId: orgCtx.userId,
  });
  if (!rateLimitVerdict.allowed) {
    return admissionError(
      `Too many attempts. Try again in ${rateLimitVerdict.retryAfterSeconds}s.`,
      429,
      { "Retry-After": String(rateLimitVerdict.retryAfterSeconds) },
    );
  }

  const encoder = new TextEncoder();
  let streamOpen = true;
  let pingInterval: ReturnType<typeof setInterval> | undefined;

  const stopPings = () => {
    if (pingInterval !== undefined) {
      clearInterval(pingInterval);
      pingInterval = undefined;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: StreamEvent) => {
        if (!streamOpen) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Do not deliberately cancel the core when the response disconnects.
          // The route is not a detached job, so a later retry must reconcile
          // any registry work whose local completion was not persisted.
          streamOpen = false;
          stopPings();
        }
      };
      const onProgress = (update: SubmissionProgressUpdate) => {
        send({ type: "progress", update });
      };

      pingInterval = setInterval(() => {
        send({ type: "ping" });
      }, SUBMISSION_STREAM_PING_INTERVAL_MS);

      void (async () => {
        try {
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
          stopPings();
          if (streamOpen) {
            controller.close();
            streamOpen = false;
          }
        }
      })();
    },
    cancel() {
      // Do not deliberately cancel the core. A disconnect does not guarantee
      // that serverless execution will continue after the response is gone.
      streamOpen = false;
      stopPings();
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
