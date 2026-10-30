// @vitest-environment jsdom
/** The pager reads "today" on the batch's own facility clock, including an archived facility's override (#1512). */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const clock = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: (...args: unknown[]) => { clock.calls.push(args); return { timeZone: "Africa/Dar_es_Salaam", hint: "" }; },
}));
vi.mock("@/hooks/use-emissions-overview", () => ({ useEmissionsOverview: () => ({ data: { batches: [] } }) }));
vi.mock("./emissions-overview-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./emissions-overview-query")>()),
  useEmissionsOverviewQuery: () => ({ query: { q: "", status: null, period: null, from: null, to: null, sort: "code", dir: "asc" } }),
}));

import { BatchEmissionsPager } from "./batch-emissions-pager";

afterEach(cleanup);

describe("BatchEmissionsPager", () => {
  it("passes the batch's facility zone override to the facility clock", () => {
    render(<BatchEmissionsPager creditBatchId="cb-1" facilityId="f-1" lineFilter={null} lineSort="template" timeZone="Africa/Dar_es_Salaam" />);
    expect(clock.calls.at(-1)).toEqual(["f-1", { timeZone: "Africa/Dar_es_Salaam" }]);
  });
});
