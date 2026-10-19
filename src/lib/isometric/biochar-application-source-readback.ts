import { IsometricApiError, SOURCE_READBACK_TIMEOUT_MS, type IsometricClient } from "./client";

const BIOCHAR_APPLICATION_SOURCES_QUERY = `query BiocharApplicationSources($projectId: ID!, $ids: [ID!]) {
  project(id: $projectId) {
    __typename
    ... on Project {
      biocharSpreadEvents(first: 2, filter: { idIn: $ids }) {
        nodes { id biocharSpreadEventSources { source { id } } }
      }
    }
    ... on ObjectNotFoundError { message }
  }
}`;

export type SourceReadbackNoAnswerReason =
  | "unreachable" | "timeout" | "http_status" | "graphql_errors"
  | "project_not_found" | "event_not_found" | "unreadable_response";
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
  input: { externalProjectId: string; externalApplicationId: string },
): Promise<SourceReadbackResult> {
  let response: unknown;
  try {
    response = await client.graphql(BIOCHAR_APPLICATION_SOURCES_QUERY, {
      projectId: input.externalProjectId,
      ids: [input.externalApplicationId],
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
  if (events.nodes.length === 0) return { kind: "no_answer", reason: "event_not_found" };
  if (events.nodes.length > 1) return { kind: "garbled", detail: "multiple_events" };
  const event: unknown = events.nodes[0];
  if (!isRecord(event) || event.id !== input.externalApplicationId) {
    return { kind: "no_answer", reason: "event_not_found" };
  }
  const sources = event.biocharSpreadEventSources;
  if (!Array.isArray(sources) || !sources.every(entry =>
    isRecord(entry) && isRecord(entry.source) && typeof entry.source.id === "string")) {
    return { kind: "garbled", detail: "invalid_source_list" };
  }
  return { kind: "found", sourceIds: sources.map(entry => entry.source.id) };
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
  const missing = [...expected].filter(id => !remote.has(id)).sort();
  const unexpected = [...remote].filter(id => !expected.has(id)).sort();
  if (!missing.length && !unexpected.length) return { outcome: "confirmed" };
  return { outcome: "mismatch", missing, unexpected,
    reason: remote.size === 0 ? "empty" : missing.length ? "missing" : "unexpected" };
}
