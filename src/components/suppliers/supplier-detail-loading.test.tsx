/**
 * The supplier header must not read a pending query as an operator omission.
 *
 * Location and Distance to facility both come from the supplier-locations
 * query, which settles after the supplier itself. Before this regression was
 * fixed the header rendered "Not recorded" for the whole of that window.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MISSING_VALUE } from "@/lib/copy-utils";

const SKELETON_MARKER = "animate-skeleton";

const supplier = {
  id: "sup-1",
  code: "SUP-26-001",
  name: "Northern Mill",
  contactEmail: "ops@example.com",
  contactPhone: "+370 600 00000",
  location: null as string | null,
  distanceToFacilityKm: null as number | null,
};

const queries = vi.hoisted(() => ({
  supplier: { data: undefined as unknown, isLoading: false, error: null },
  locations: { data: undefined as unknown, isLoading: false },
}));

const idleMutation = () => ({ mutateAsync: vi.fn(), isPending: false });

vi.mock("@/hooks/use-suppliers", () => ({
  useSupplier: () => queries.supplier,
  useSupplierLocationsBySupplier: () => queries.locations,
  useDeleteSupplierLocation: idleMutation,
  useCreateSupplierLocation: idleMutation,
  useUpdateSupplierLocation: idleMutation,
}));

const { SupplierDetail } = await import("./supplier-detail");

function renderDetail() {
  return renderToStaticMarkup(<SupplierDetail supplierId={supplier.id} />);
}

/** The header value slot for one label, so a neighbouring field cannot satisfy an assertion. */
function valueSlot(markup: string, label: string): string {
  // The label may be followed by a CERT chip inside the same <dt>.
  const slot = new RegExp(`>${label}.*?</dt>(.*?)</dd>`, "s").exec(markup);
  expect(slot, `no header field labelled ${label}`).not.toBeNull();
  return slot![1];
}

describe("supplier detail header while locations load", () => {
  it("shows a skeleton for Location instead of claiming it was not recorded", () => {
    queries.supplier = { data: supplier, isLoading: false, error: null };
    queries.locations = { data: undefined, isLoading: true };

    const location = valueSlot(renderDetail(), "Location");

    expect(location).toContain(SKELETON_MARKER);
    expect(location).not.toContain(MISSING_VALUE.notRecorded);
  });

  it("keeps the distance field pending rather than reporting it as not set", () => {
    queries.supplier = { data: supplier, isLoading: false, error: null };
    queries.locations = { data: undefined, isLoading: true };

    const distance = valueSlot(renderDetail(), "Distance to facility");

    expect(distance).not.toContain(MISSING_VALUE.notSet);
    expect(distance).toContain('aria-busy="true"');
    expect(distance).toContain(SKELETON_MARKER);
  });

  it("gives a settled empty header field the shared placeholder treatment", () => {
    queries.supplier = { data: supplier, isLoading: false, error: null };
    queries.locations = { data: [], isLoading: false };

    const location = valueSlot(renderDetail(), "Location");

    expect(location).toContain(MISSING_VALUE.notRecorded);
    expect(location).toContain('data-empty="true"');
    expect(location).toContain("--color-text-tertiary");
    expect(location).not.toContain("--color-text-primary");
  });

  it("leaves a real header value at full strength", () => {
    queries.supplier = {
      data: { ...supplier, location: "Kaunas, Lithuania" },
      isLoading: false,
      error: null,
    };
    queries.locations = { data: [], isLoading: false };

    const location = valueSlot(renderDetail(), "Location");

    expect(location).toContain("--color-text-primary");
    expect(location).not.toContain("data-empty");
  });

  it("names the omission once the locations query settles empty", () => {
    queries.supplier = { data: supplier, isLoading: false, error: null };
    queries.locations = { data: [], isLoading: false };

    const markup = renderDetail();

    expect(valueSlot(markup, "Location")).toContain(MISSING_VALUE.notRecorded);
    expect(markup).not.toContain(SKELETON_MARKER);
  });

  it("shows a legacy supplier location immediately, because it needs no query", () => {
    queries.supplier = {
      data: { ...supplier, location: "Kaunas, Lithuania" },
      isLoading: false,
      error: null,
    };
    queries.locations = { data: undefined, isLoading: true };

    const location = valueSlot(renderDetail(), "Location");

    expect(location).toContain("Kaunas, Lithuania");
    expect(location).not.toContain(SKELETON_MARKER);
  });

  it("resolves the default location label once the query settles", () => {
    queries.supplier = { data: supplier, isLoading: false, error: null };
    queries.locations = {
      data: [
        {
          id: "loc-1",
          name: "Sawmill yard",
          country: "Lithuania",
          stateRegion: null,
          city: "Kaunas",
          address: null,
          gpsLatitude: null,
          gpsLongitude: null,
          distanceFromFacilityKm: 2.5,
          isDefault: true,
        },
      ],
      isLoading: false,
    };

    const markup = renderDetail();

    expect(valueSlot(markup, "Location")).toContain(
      "Sawmill yard, Kaunas, Lithuania",
    );
    expect(valueSlot(markup, "Distance to facility")).toContain("2.5 km");
  });
});
