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
            '"state":"complete"}}\n{"type":"ping"}\n{"type":"result","result":{"removalId":"11111111-1111-4111-8111-111111111111","externalId":"rm-1","version":2}}\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const updates: string[] = [];

    const result = await streamCertificationSubmission<{
      removalId: string;
      externalId: string;
      version: number;
    }>({ kind: "removal", input: REMOVAL_INPUT }, (update) => {
      updates.push(`${update.step}:${update.state}`);
    });

    expect(updates).toEqual(["removal.checking_data:complete"]);
    expect(result).toEqual({
      removalId: REMOVAL_INPUT.removalId,
      externalId: "rm-1",
      version: 2,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/certification/submissions",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("returns a valid GHG Statement result", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"type":"result","result":{"externalId":"ghg-1","remoteStatus":"AWAITING_VERIFICATION"}}\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(
      streamCertificationSubmission(
        {
          kind: "ghg_statement",
          ghgStatementId: "22222222-2222-4222-8222-222222222222",
          input: {
            reportId: "33333333-3333-4333-8333-333333333333",
            confirmProduction: true,
          },
        },
        () => undefined,
      ),
    ).resolves.toEqual({
      externalId: "ghg-1",
      remoteStatus: "AWAITING_VERIFICATION",
    });
  });

  it.each([
    [
      "removal",
      { kind: "removal" as const, input: REMOVAL_INPUT },
      "The Removal submission could not be confirmed. Close this dialog and refresh the page before trying again.",
    ],
    [
      "GHG Statement",
      {
        kind: "ghg_statement" as const,
        ghgStatementId: "22222222-2222-4222-8222-222222222222",
        input: {
          reportId: "33333333-3333-4333-8333-333333333333",
          confirmProduction: true,
        },
      },
      "The GHG Statement submission could not be confirmed. Close this dialog and refresh the page before trying again.",
    ],
  ])("gives a safe recovery action when a %s stream ends without a result", async (_name, request, expected) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(
      streamCertificationSubmission(request, () => undefined),
    ).rejects.toThrow(expected);
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

  it("surfaces a safe admission error from the route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { error: "Too many attempts. Try again in 17s." },
          { status: 429 },
        ),
      ),
    );

    await expect(
      streamCertificationSubmission(
        { kind: "removal", input: REMOVAL_INPUT },
        () => undefined,
      ),
    ).rejects.toThrow("Too many attempts. Try again in 17s.");
  });

  it("uses a generic admission error for an unreadable response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("upstream details", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    await expect(
      streamCertificationSubmission(
        { kind: "removal", input: REMOVAL_INPUT },
        () => undefined,
      ),
    ).rejects.toThrow("The submission could not be started. Try again.");
  });

  it.each([
    ["malformed NDJSON", "not-json\n"],
    ["a trailing NDJSON fragment", '{"type":"result","result":'],
    ["a null event", "null\n"],
    ["an array event", "[]\n"],
    ["an unknown event type", '{"type":"unknown"}\n'],
    ["a progress event without an update", '{"type":"progress"}\n'],
    [
      "a progress event with an invalid nested update",
      '{"type":"progress","update":{"step":"unknown","state":"complete"}}\n',
    ],
    ["an error event without a message", '{"type":"error","error":""}\n'],
    ["a result event without a result", '{"type":"result"}\n'],
    ["a null Removal result", '{"type":"result","result":null}\n'],
    ["a primitive Removal result", '{"type":"result","result":42}\n'],
    ["an array Removal result", '{"type":"result","result":[]}\n'],
    [
      "a Removal result with missing fields",
      '{"type":"result","result":{"externalId":"rm-1"}}\n',
    ],
  ])("turns %s into a recoverable operator message", async (_name, chunk) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(
      streamCertificationSubmission(
        { kind: "removal", input: REMOVAL_INPUT },
        () => undefined,
      ),
    ).rejects.toThrow(
      "The progress connection returned an unreadable response. Close this dialog and refresh the page before trying again.",
    );
  });

  it("rejects an invalid GHG Statement result", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            '{"type":"result","result":{"externalId":"ghg-1","remoteStatus":"UNKNOWN"}}\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    await expect(
      streamCertificationSubmission(
        {
          kind: "ghg_statement",
          ghgStatementId: "22222222-2222-4222-8222-222222222222",
          input: {
            reportId: "33333333-3333-4333-8333-333333333333",
            confirmProduction: true,
          },
        },
        () => undefined,
      ),
    ).rejects.toThrow(
      "The progress connection returned an unreadable response. Close this dialog and refresh the page before trying again.",
    );
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
