import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreateGateNotice, deriveGhgCreateGate } from "./ghg-statements-list";

describe("deriveGhgCreateGate", () => {
  it("keeps both buttons off and shows no notice while the summary loads", () => {
    expect(
      deriveGhgCreateGate({
        isLoading: true,
        isError: false,
        hasMapping: false,
        linkedFacilityCount: undefined,
      }),
    ).toEqual({ canSync: false, canCreate: false, notice: null });
  });

  it("shows the failure notice and keeps both buttons off when the summary errors", () => {
    expect(
      deriveGhgCreateGate({
        isLoading: false,
        isError: true,
        hasMapping: false,
        linkedFacilityCount: undefined,
      }),
    ).toEqual({ canSync: false, canCreate: false, notice: "mappingFailed" });
  });

  it("shows the unlinked notice when the facility has no mapping", () => {
    expect(
      deriveGhgCreateGate({
        isLoading: false,
        isError: false,
        hasMapping: false,
        linkedFacilityCount: 0,
      }),
    ).toEqual({ canSync: false, canCreate: false, notice: "unlinked" });
  });

  it("enables Create and Sync for a dedicated project", () => {
    expect(
      deriveGhgCreateGate({
        isLoading: false,
        isError: false,
        hasMapping: true,
        linkedFacilityCount: 1,
      }),
    ).toEqual({ canSync: true, canCreate: true, notice: null });
  });

  it("keeps Sync available but disables Create for a shared project", () => {
    expect(
      deriveGhgCreateGate({
        isLoading: false,
        isError: false,
        hasMapping: true,
        linkedFacilityCount: 2,
      }),
    ).toEqual({ canSync: true, canCreate: false, notice: "sharedProject" });
  });
});

describe("CreateGateNotice", () => {
  it("renders nothing when there is no notice", () => {
    expect(
      renderToStaticMarkup(
        <CreateGateNotice
          notice={null}
          facilityId="fac-1"
          linkedFacilityCount={1}
        />,
      ),
    ).toBe("");
  });

  it("names the shared-project problem and links the repair in Settings", () => {
    const html = renderToStaticMarkup(
      <CreateGateNotice
        notice="sharedProject"
        facilityId="fac 1"
        linkedFacilityCount={2}
      />,
    );

    expect(html).toContain("linked to 2 noma facilities");
    expect(html).toContain("Link each facility to a dedicated Isometric project");
    expect(html).toContain("/certification/settings?facility=fac%201");
  });

  it("asks the operator to link the facility when no mapping exists", () => {
    const html = renderToStaticMarkup(
      <CreateGateNotice
        notice="unlinked"
        facilityId="fac-1"
        linkedFacilityCount={undefined}
      />,
    );

    expect(html).toContain("Link this facility to an Isometric project");
  });
});
