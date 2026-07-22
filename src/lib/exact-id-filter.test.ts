import { describe, expect, it } from "vitest";
import { parseExactIdFilter } from "./exact-id-filter";

const FIRST_ID = "00000000-0000-4000-a000-000000000001";
const SECOND_ID = "00000000-0000-4000-a000-000000000002";

describe("parseExactIdFilter", () => {
  it("keeps valid unique UUIDs in link order", () => {
    expect(parseExactIdFilter(`${FIRST_ID},${SECOND_ID},${FIRST_ID}`)).toEqual({
      ids: [FIRST_ID, SECOND_ID],
      normalized: `${FIRST_ID},${SECOND_ID}`,
      hadInvalidValues: false,
    });
  });

  it("drops malformed values without making the destination fail", () => {
    expect(parseExactIdFilter(`bad-id,${FIRST_ID},`)).toEqual({
      ids: [FIRST_ID],
      normalized: FIRST_ID,
      hadInvalidValues: true,
    });
  });
});
