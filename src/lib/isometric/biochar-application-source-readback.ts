import { IsometricApiError, SOURCE_READBACK_TIMEOUT_MS, type IsometricClient } from "./client";

// Isometric refuses a page size above 50 ("Page size must be >= 0 and <= 50").
const BIOCHAR_APPLICATION_SOURCES_PAGE_SIZE = 50;
export const BIOCHAR_APPLICATION_SOURCES_MAX_PAGES = 10;

const BIOCHAR_APPLICATION_SOURCES_QUERY = `query BiocharApplicationSources($projectId: ID!, $ids: [ID!], $storageLocationId: ID!, $after: String) {
  project(id: $projectId) {
    __typename
    ... on Project {
      biocharSpreadEvents(first: ${BIOCHAR_APPLICATION_SOURCES_PAGE_SIZE}, after: $after, filter: { idIn: $ids, storageLocationId: $storageLocationId }) {
        nodes { id biocharSpreadEventSources { source { id } } }
        pageInfo { hasNextPage endCursor }
      }
    }
    ... on ObjectNotFoundError { message }
  }
}`;

export type SourceReadbackNoAnswerReason =
  | "unreachable" | "timeout" | "http_status" | "graphql_errors"
  | "project_not_found" | "event_not_found" | "unreadable_response" | "sources_not_attached";
export type SourceReadbackResult =
  | { kind: "found"; sourceIds: unknown }
  | { kind: "garbled"; detail: string }
  | { kind: "no_answer"; reason: SourceReadbackNoAnswerReason };
export type SourceReadbackOutcome =
  | { outcome: "confirmed" }
  | { outcome: "mismatch"; missing: string[]; unexpected: string[]; reason: "missing" | "unexpected" | "empty" | "garbled" }
  | { outcome: "unconfirmed"; reason: SourceReadbackNoAnswerReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readBiocharApplicationSources(
  client: IsometricClient,
  input: { externalProjectId: string; externalApplicationId: string; externalStorageLocationId: string },
): Promise<SourceReadbackResult> {
  let after: string | null = null;
  const seenCursors = new Set<string>();
  for (let page = 0; page < BIOCHAR_APPLICATION_SOURCES_MAX_PAGES; page++) {
    let response: unknown;
    try {
      response = await client.graphql(BIOCHAR_APPLICATION_SOURCES_QUERY, {
        projectId: input.externalProjectId,
        ids: [input.externalApplicationId],
        storageLocationId: input.externalStorageLocationId,
        after,
      }, { timeoutMs: SOURCE_READBACK_TIMEOUT_MS });
    } catch (error) {
      if (!(error instanceof IsometricApiError)) throw error;
      const reason = error.readFailureReason === "timeout" ? "timeout"
        : error.readFailureReason === "unreadable_response" ? "unreadable_response"
        : error.status !== undefined ? "http_status" : "unreachable";
      return { kind: "no_answer", reason };
    }
    if (!isRecord(response)) return { kind: "no_answer", reason: "unreadable_response" };
    // Partial data accompanying errors is not an authoritative answer.
    if (response.errors != null) return { kind: "no_answer", reason: "graphql_errors" };
    const project = isRecord(response.data) ? response.data.project : undefined;
    if (!isRecord(project)) return { kind: "no_answer", reason: "unreadable_response" };
    if (project.__typename === "ObjectNotFoundError") return { kind: "no_answer", reason: "project_not_found" };
    const events = project.biocharSpreadEvents;
    if (project.__typename !== "Project" || !isRecord(events) || !Array.isArray(events.nodes)) {
      return { kind: "no_answer", reason: "unreadable_response" };
    }
    // The sandbox ignores idIn. Only the requested Application can answer this read.
    const matches = events.nodes.filter((event): event is Record<string, unknown> =>
      isRecord(event) && event.id === input.externalApplicationId);
    if (matches.length > 1) return { kind: "garbled", detail: "multiple_events" };
    const event = matches[0];
    if (event) {
      const sources = event.biocharSpreadEventSources;
      if (!Array.isArray(sources) || !sources.every(entry =>
        isRecord(entry) && isRecord(entry.source) && typeof entry.source.id === "string")) {
        return { kind: "garbled", detail: "invalid_source_list" };
      }
      return { kind: "found", sourceIds: sources.map(entry => entry.source.id) };
    }
    if (page + 1 === BIOCHAR_APPLICATION_SOURCES_MAX_PAGES) break;
    const pageInfo = events.pageInfo;
    if (!isRecord(pageInfo) || typeof pageInfo.hasNextPage !== "boolean") {
      return { kind: "no_answer", reason: "unreadable_response" };
    }
    if (!pageInfo.hasNextPage) break;
    if (typeof pageInfo.endCursor !== "string" || !pageInfo.endCursor.trim() || seenCursors.has(pageInfo.endCursor)) {
      return { kind: "no_answer", reason: "unreadable_response" };
    }
    after = pageInfo.endCursor;
    seenCursors.add(after);
  }
  return { kind: "no_answer", reason: "event_not_found" };
}

export function classifySourceReadback(
  expectedSourceIds: readonly string[],
  result: SourceReadbackResult,
): SourceReadbackOutcome {
  if (result.kind === "no_answer") return { outcome: "unconfirmed", reason: result.reason };
  if (result.kind === "garbled" || !Array.isArray(result.sourceIds) ||
    !result.sourceIds.every((id: unknown) => typeof id === "string")) {
    return { outcome: "mismatch", missing: [], unexpected: [], reason: "garbled" };
  }
  const expected = new Set(expectedSourceIds);
  const remote = new Set<string>(result.sourceIds);
  if (remote.size === 0 && expected.size > 0) {
    return { outcome: "unconfirmed", reason: "sources_not_attached" };
  }
  const missing = [...expected].filter(id => !remote.has(id)).sort();
  const unexpected = [...remote].filter(id => !expected.has(id)).sort();
  if (!missing.length && !unexpected.length) return { outcome: "confirmed" };
  return { outcome: "mismatch", missing, unexpected,
    reason: missing.length ? "missing" : "unexpected" };
}

/**
 * A found Application with none of its expected Sources, once any attach wait
 * is over, is a mismatch: Isometric answered and lists no evidence.
 */
export function failClosedOnEmptySources(
  expectedSourceIds: readonly string[],
  outcome: SourceReadbackOutcome,
): SourceReadbackOutcome {
  if (outcome.outcome !== "unconfirmed" || outcome.reason !== "sources_not_attached") return outcome;
  return { outcome: "mismatch", missing: [...new Set(expectedSourceIds)].sort(), unexpected: [], reason: "empty" };
}
