import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSubmissionStreamStalledError,
  streamCertificationSubmission,
} from "./submission-progress-client";

const REMOVAL_INPUT = {
  removalId: "11111111-1111-4111-8111-111111111111",
  compilationHash: "a".repeat(64),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamCertificationSubmission", () => {
  it("delivers chunked progress updates before returning the result", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            '{"type":"progress","update":{"step":"removal.checking_data",',
          ),
        );
        controller.enqueue(
          encoder.encode(
            '"state":"complete"}}\n{"type":"result","result":{"externalId":"rm-1","version":2}}\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const updates: string[] = [];

    const result = await streamCertificationSubmission<{
      externalId: string;
      version: number;
    }>({ kind: "removal", input: REMOVAL_INPUT }, (update) => {
      updates.push(`${update.step}:${update.state}`);
    });

    expect(updates).toEqual(["removal.checking_data:complete"]);
    expect(result).toEqual({ externalId: "rm-1", version: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/certification/submissions",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("surfaces a safe streamed error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"type":"error","error":"The verifier rejected the statement."}\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(
      streamCertificationSubmission(
        { kind: "removal", input: REMOVAL_INPUT },
        () => undefined,
      ),
    ).rejects.toThrow("The verifier rejected the statement.");
  });

  it("unlocks a stalled submission and warns that registry work may continue", async () => {
    const body = new ReadableStream<Uint8Array>({
      start() {
        // Keep the stream open without sending progress or a result.
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);

    const submission = streamCertificationSubmission(
      { kind: "removal", input: REMOVAL_INPUT },
      () => undefined,
      { readTimeoutMs: 5 },
    );

    await expect(submission).rejects.toSatisfy((error: unknown) => {
      expect(isSubmissionStreamStalledError(error)).toBe(true);
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("registry submission may still be running"),
      );
      return true;
    });

    const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  it("passes caller cancellation to the request signal", async () => {
    const caller = new AbortController();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const submission = streamCertificationSubmission(
      { kind: "removal", input: REMOVAL_INPUT },
      () => undefined,
      { signal: caller.signal },
    );
    caller.abort(new Error("Dialog closed."));

    await expect(submission).rejects.toThrow("Dialog closed.");
  });
});
