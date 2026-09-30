import { describe, expect, it, vi } from "vitest";
import {
  createIsometricClientFromTransport,
  IsometricPageLimitError,
} from "./client";
import { findRegistryRecord } from "./find-record";

interface Row {
  id: string;
  ref: string;
}

function page(nodes: Row[], endCursor: string | null, hasNextPage = endCursor !== null) {
  return {
    nodes,
    page_info: { has_next_page: hasNextPage, end_cursor: endCursor },
    total_count: nodes.length,
  };
}

/** A client whose GETs answer with `pages` in order. */
function clientOver(...pages: ReturnType<typeof page>[]) {
  const get = vi.fn();
  for (const next of pages) get.mockResolvedValueOnce(next);
  const client = createIsometricClientFromTransport((_method, path, options) =>
    get(path, options),
  );
  return { client, get };
}

const unique = {
  match: "unique" as const,
  duplicateMessage: "Two records share this reference.",
};

describe("paginate bounds", () => {
  it("follows cursors until the last page", async () => {
    const { client, get } = clientOver(
      page([{ id: "a", ref: "x" }], "c1"),
      page([{ id: "b", ref: "y" }], null),
    );
    await expect(client.paginateAll<Row>("/rows")).resolves.toHaveLength(2);
    expect(get).toHaveBeenNthCalledWith(2, "/rows", {
      query: { first: 50, after: "c1" },
    });
  });

  it("refuses to walk past the page cap", async () => {
    const { client } = clientOver(page([], "c1"), page([], "c2"));
    const walk = client.paginateAll<Row>("/rows", { pageSize: 10, maxPages: 2 });
    await expect(walk).rejects.toThrow(IsometricPageLimitError);
    await expect(
      clientOver(page([], "c1")).client.paginateAll("/rows", { maxPages: 1 }),
    ).rejects.toThrow(/more than 50 records/);
  });

  it("stops on a repeated cursor instead of looping", async () => {
    const { client, get } = clientOver(page([], "c1"), page([], "c1"));
    await expect(client.paginateAll<Row>("/rows")).rejects.toThrow(
      /repeated cursor c1/,
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("stops when another page is reported without a cursor", async () => {
    const { client } = clientOver(page([{ id: "a", ref: "x" }], null, true));
    await expect(client.paginateAll<Row>("/rows")).rejects.toThrow(
      /another page without a cursor/,
    );
  });

  it.each([0, 51, 1.5])("rejects page size %s before any request", async (pageSize) => {
    const { client, get } = clientOver();
    await expect(client.paginateAll<Row>("/rows", { pageSize })).rejects.toThrow(
      /between 1 and 50/,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("applies the cap to finders built on paginate", async () => {
    const { client } = clientOver(page([{ id: "a", ref: "other" }], "c1"));
    await expect(
      findRegistryRecord<Row>(client, "/rows", {
        ...unique,
        where: (row) => row.ref === "x",
        paginate: { maxPages: 1 },
      }),
    ).rejects.toThrow(IsometricPageLimitError);
  });
});

describe("findRegistryRecord", () => {
  it("returns the first match without reading later pages", async () => {
    const { client, get } = clientOver(
      page([{ id: "a", ref: "x" }], "c1"),
      page([{ id: "b", ref: "x" }], null),
    );
    await expect(
      findRegistryRecord<Row>(client, "/rows", {
        match: "first",
        where: (row) => row.ref === "x",
      }),
    ).resolves.toEqual({ id: "a", ref: "x" });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("walks every page in unique mode and refuses a second record", async () => {
    const { client } = clientOver(
      page([{ id: "a", ref: "x" }], "c1"),
      page([{ id: "b", ref: "x" }], null),
    );
    await expect(
      findRegistryRecord<Row>(client, "/rows", {
        ...unique,
        where: (row) => row.ref === "x",
      }),
    ).rejects.toThrow("Two records share this reference.");
  });

  it("treats the same record seen twice as one match", async () => {
    const { client } = clientOver(
      page([{ id: "a", ref: "x" }], "c1"),
      page([{ id: "a", ref: "x" }], null),
    );
    await expect(
      findRegistryRecord<Row>(client, "/rows", {
        ...unique,
        where: (row) => row.ref === "x",
      }),
    ).resolves.toEqual({ id: "a", ref: "x" });
  });

  it("returns null after a complete walk with no match", async () => {
    const { client } = clientOver(page([{ id: "a", ref: "y" }], null));
    await expect(
      findRegistryRecord<Row>(client, "/rows", {
        ...unique,
        where: (row) => row.ref === "x",
      }),
    ).resolves.toBeNull();
  });

  it("sends the server-side query and page size", async () => {
    const { client, get } = clientOver(page([], null));
    await findRegistryRecord<Row>(client, "/rows", {
      match: "first",
      where: () => true,
      paginate: { query: { supplier_reference_id: "x" }, pageSize: 1 },
    });
    expect(get).toHaveBeenCalledWith("/rows", {
      query: { supplier_reference_id: "x", first: 1, after: undefined },
    });
  });
});
