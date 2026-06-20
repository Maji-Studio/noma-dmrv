/**
 * Transport-leg evidence → Sources.
 *
 * Per-leg transport data can't reach the verifier as data (legs are
 * aggregated into one `mass_distance` scalar — no LIST transport blueprint),
 * so a leg's bill of lading / weigh-scale ticket must arrive as a Source on
 * the datapoint. That only works if the candidate-document walk actually looks
 * at transport legs. These tests pin that wiring on the submit-path collector
 * (`collectCandidateDocumentIdsForRemoval`) and confirm a leg doc resolves to
 * a Source id (`resolveSourceIdsForRemoval`).
 *
 * `transport_legs.entityType` is its own enum (feedstock | biochar | sample)
 * and does NOT match the document entity strings — note "biochar" here vs.
 * "biochar_product" in the lineage. One test guards that mapping explicitly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  getUser: vi.fn(async () => ({ id: USER_ID })),
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/data-access/transport-legs");
vi.mock("@/data-access/documents");
vi.mock("@/data-access/certifier-document-uploads");
vi.mock("@/data-access/credit-batch-samples", () => ({
  getSamplesByCreditBatchIds: vi.fn(),
}));

// Valid-ish UUIDs (these are passed through, not parsed, but keep them
// realistic so the fixtures read like production ids).
const USER_ID = "00000000-0000-4000-8000-000000000001";
const BATCH_ID = "10000000-0000-4000-8000-000000000001";
const APP_ID = "20000000-0000-4000-8000-000000000001";
const DELIVERY_ID = "30000000-0000-4000-8000-000000000001";
const RUN_ID = "40000000-0000-4000-8000-000000000001";
const FEEDSTOCK_ID = "50000000-0000-4000-8000-000000000001";
const BIOCHAR_ID = "60000000-0000-4000-8000-000000000001";
const SAMPLE_ID = "70000000-0000-4000-8000-000000000001";

const BIOCHAR_LEG_ID = "80000000-0000-4000-8000-000000000001";
const SAMPLE_LEG_ID = "80000000-0000-4000-8000-000000000002";
const BIOCHAR_LEG_DOC_ID = "90000000-0000-4000-8000-000000000001";
const SAMPLE_LEG_DOC_ID = "90000000-0000-4000-8000-000000000002";
const BIOCHAR_DIRECT_DOC_ID = "90000000-0000-4000-8000-000000000003";

import * as transportLegsDA from "@/data-access/transport-legs";
import * as documentsDA from "@/data-access/documents";
import * as uploadsDA from "@/data-access/certifier-document-uploads";
import * as creditBatchSamplesDA from "@/data-access/credit-batch-samples";
import {
  collectCandidateDocumentIdsForRemoval,
  resolveSourceIdsForRemoval,
} from "@/fn/certification/sources";

const lineageArgs = {
  lineages: [
    {
      application: { id: APP_ID },
      delivery: { id: DELIVERY_ID },
      order: null,
      biocharProduct: { id: BIOCHAR_ID },
      productionRun: { id: RUN_ID },
      reactor: null,
      feedstocks: [{ id: FEEDSTOCK_ID }],
    },
  ],
  memberBatchIds: [BATCH_ID],
};

beforeEach(() => {
  vi.clearAllMocks();

  // Lab samples now roll up to the credit batch (ADR 0016): the collector
  // resolves sample ids via `getSamplesByCreditBatchIds`, not `run.samples`.
  vi.mocked(creditBatchSamplesDA.getSamplesByCreditBatchIds).mockResolvedValue([
    { id: SAMPLE_ID, creditBatchId: BATCH_ID },
  ]);

  // Legs hang off the biochar product (outbound) and the lab sample. The
  // feedstock leg is auto-derived with no manual upload → return none.
  vi.mocked(transportLegsDA.getTransportLegsForEntities).mockImplementation(
    async (_userId, entityType, entityIds) => {
      if (entityType === "biochar" && entityIds.includes(BIOCHAR_ID)) {
        return [
          {
            id: BIOCHAR_LEG_ID,
            originName: "Yard",
            destinationName: "Field A",
            transportMethodType: "road",
          },
        ] as never;
      }
      if (entityType === "sample" && entityIds.includes(SAMPLE_ID)) {
        return [
          {
            id: SAMPLE_LEG_ID,
            originName: null,
            destinationName: "Lab",
            transportMethodType: "road",
          },
        ] as never;
      }
      return [] as never;
    },
  );

  // Docs: one on each leg, plus a control doc directly on the biochar product
  // to prove the existing walk still works alongside the new leg branch.
  vi.mocked(documentsDA.listDocumentsForEntity).mockImplementation(
    async (_userId, entityType, entityId) => {
      if (entityType === "transport_leg" && entityId === BIOCHAR_LEG_ID) {
        return [{ id: BIOCHAR_LEG_DOC_ID }] as never;
      }
      if (entityType === "transport_leg" && entityId === SAMPLE_LEG_ID) {
        return [{ id: SAMPLE_LEG_DOC_ID }] as never;
      }
      if (entityType === "biochar_product" && entityId === BIOCHAR_ID) {
        return [{ id: BIOCHAR_DIRECT_DOC_ID }] as never;
      }
      return [] as never;
    },
  );
});

describe("collectCandidateDocumentIdsForRemoval — transport-leg evidence", () => {
  it("includes bill-of-lading docs uploaded against biochar + sample legs", async () => {
    const ids = await collectCandidateDocumentIdsForRemoval(USER_ID, lineageArgs);

    expect(ids).toContain(BIOCHAR_LEG_DOC_ID);
    expect(ids).toContain(SAMPLE_LEG_DOC_ID);
    // The pre-existing chain walk is untouched — direct biochar docs still in.
    expect(ids).toContain(BIOCHAR_DIRECT_DOC_ID);
    // Deterministic: sorted + deduped.
    expect(ids).toStrictEqual([...ids].sort());
  });

  it("resolves legs for the feedstock / biochar / sample entities in the lineage", async () => {
    await collectCandidateDocumentIdsForRemoval(USER_ID, lineageArgs);

    const calls = vi.mocked(transportLegsDA.getTransportLegsForEntities).mock
      .calls;
    expect(calls.map((c) => c[1]).sort()).toStrictEqual([
      "biochar",
      "feedstock",
      "sample",
    ]);
    // The "biochar" leg query must carry the biochar-PRODUCT id — guards the
    // entityType-name mismatch (biochar vs biochar_product).
    const biocharCall = calls.find((c) => c[1] === "biochar");
    expect(biocharCall?.[2]).toContain(BIOCHAR_ID);
  });

  it("does not double-count a leg doc when its parent appears in two lineages", async () => {
    const sharedBiocharArgs = {
      ...lineageArgs,
      lineages: [
        lineageArgs.lineages[0],
        {
          ...lineageArgs.lineages[0],
          application: { id: "21000000-0000-4000-8000-000000000001" },
          delivery: { id: "31000000-0000-4000-8000-000000000001" },
        },
      ],
    };

    const ids = await collectCandidateDocumentIdsForRemoval(
      USER_ID,
      sharedBiocharArgs,
    );

    expect(ids.filter((id) => id === BIOCHAR_LEG_DOC_ID)).toHaveLength(1);
  });

  it("collects nothing extra when legs have no documents", async () => {
    vi.mocked(documentsDA.listDocumentsForEntity).mockResolvedValue(
      [] as never,
    );
    const ids = await collectCandidateDocumentIdsForRemoval(USER_ID, lineageArgs);
    expect(ids).toStrictEqual([]);
  });
});

describe("resolveSourceIdsForRemoval — leg doc → Source id", () => {
  it("maps a mirrored leg document to its external Source id", async () => {
    vi.mocked(uploadsDA.listDocumentUploadsForDocuments).mockResolvedValue([
      {
        documentId: BIOCHAR_LEG_DOC_ID,
        externalDocumentId: "src_leg_bol_1",
      },
    ] as never);

    const sourceIds = await resolveSourceIdsForRemoval(USER_ID, {
      candidateDocumentIds: [BIOCHAR_LEG_DOC_ID],
    });

    expect(sourceIds).toStrictEqual(["src_leg_bol_1"]);
  });
});
