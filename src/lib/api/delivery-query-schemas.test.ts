import { expect, it } from "vitest";
import { deliveryListSchema } from "./query-schemas";
import { parseApiQuery } from "./query";

const id = "df2795a4-886b-4a89-bbdd-532c6b1b8e45";
const parse = (query: string) => parseApiQuery(new Request(`https://example.test/api/v1/deliveries?${query}`), deliveryListSchema);
it("parses delivery references and offset instant range bounds", () => {
  expect(parse(`facilityId=${id.toUpperCase()}&orderId=${id.toUpperCase()}&storageLocationId=${id.toUpperCase()}&code=DL-1&q=dl&deliveredFrom=2026-09-12T12:00:00Z&deliveredBefore=2026-09-13T12:00:00%2B03:00`))
    .toMatchObject({ facilityId: id, orderId: id, storageLocationId: id, code: "DL-1", q: "dl", deliveredFrom: "2026-09-12T12:00:00Z", deliveredBefore: "2026-09-13T12:00:00+03:00" });
});
it("refuses unknown keys, invalid references, repeated keys and non-instant bounds", () => {
  for (const query of ["status=delivered", "orderId=bad", "storageLocationId=bad", "q=a&q=b",
    "deliveredFrom=2026-09-12", "deliveredBefore=2026-09-12T12:00:00", "deliveredFrom=2026-02-30T00:00:00Z"]) {
    expect(() => parse(query)).toThrow(expect.objectContaining({ code: "invalid_query" }));
  }
});
