import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedstockForm } from "./feedstock-form";

interface CapturedEntitySelectProps {
  name: string;
  entityType: string;
  filterBy?: Record<string, string>;
}

interface CapturedFeedstockTypeDialogProps {
  defaultUsage?: "pyrolysis" | "blend";
}

interface CapturedStorageLocationDialogProps {
  defaultFeedstockTypeId?: string;
  feedstockTypeUsage?: "pyrolysis" | "blend";
}

const harness = vi.hoisted(() => ({
  entitySelects: [] as CapturedEntitySelectProps[],
  feedstockTypeDialog: undefined as CapturedFeedstockTypeDialogProps | undefined,
  storageLocationDialog: undefined as CapturedStorageLocationDialogProps | undefined,
  reset() {
    this.entitySelects = [];
    this.feedstockTypeDialog = undefined;
    this.storageLocationDialog = undefined;
  },
}));

vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: (name: string) => ({ name }),
    handleSubmit: () => () => undefined,
    control: {},
    trigger: vi.fn(),
    setValue: vi.fn(),
    getValues: vi.fn(),
    resetField: vi.fn(),
    formState: { errors: {}, dirtyFields: {} },
  }),
  useWatch: ({ name }: { name: string }) => {
    const values: Record<string, unknown> = {
      allocations: [{ storageLocationId: "", allocatedWetMassKg: 0 }],
      facilityId: "facility-1",
      feedstockTypeId: "blend-feedstock-type-1",
      supplierId: "",
      transportTripType: "return",
    };
    return values[name];
  },
  useFieldArray: () => ({
    fields: [{ id: "allocation-1" }],
    append: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  FormInput: ({
    error,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) => (
    <input aria-invalid={error || undefined} {...props} />
  ),
  FormTextarea: ({
    error,
    ...props
  }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) => (
    <textarea aria-invalid={error || undefined} {...props} />
  ),
  FormEntitySelect: (props: CapturedEntitySelectProps) => {
    harness.entitySelects.push(props);
    return null;
  },
  FormSection: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  FormSpine: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MassMoistureFields: () => null,
  ResolvedErrorRevalidator: () => null,
  makeCertFieldStatus: () => () => "neutral",
  resolveCertFieldStatus: () => "neutral",
}));

vi.mock("@/components/forms/form-actions", () => ({ FormActions: () => null }));
vi.mock("@/components/forms/form-select", () => ({ FormSelect: () => null }));
vi.mock("@/components/ui", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/ui/actionable-focus-target", () => ({
  ActionableFocusTarget: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  ArrowCounterClockwiseIcon: () => null,
  CalendarIcon: () => null,
  MapPinIcon: () => null,
  NoteIcon: () => null,
  PlantIcon: () => null,
  PlusIcon: () => null,
  StackIcon: () => null,
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));
vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({ defaults: { defaultTripType: "return" } }),
}));
vi.mock("@/hooks/use-suppliers", () => ({
  useSupplier: () => ({ data: undefined }),
  useSupplierLocationsBySupplier: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-transport-legs", () => ({
  useTransportLegsForEntity: () => ({ data: undefined }),
}));

vi.mock("@/components/forms/entity-select", () => ({
  useQuickAddDialog: () => ({
    isOpen: false,
    open: vi.fn(),
    close: vi.fn(),
  }),
}));
vi.mock("@/components/forms/entity-select/vehicle-quick-add-dialog", () => ({
  VehicleQuickAddDialog: () => null,
}));
vi.mock("@/components/forms/entity-select/feedstock-type-quick-add-dialog", () => ({
  FeedstockTypeQuickAddDialog: (props: CapturedFeedstockTypeDialogProps) => {
    harness.feedstockTypeDialog = props;
    return null;
  },
}));
vi.mock("@/components/forms/entity-select/storage-location-quick-add-dialog", () => ({
  StorageLocationQuickAddDialog: (props: CapturedStorageLocationDialogProps) => {
    harness.storageLocationDialog = props;
    return null;
  },
}));

vi.mock("./bin-allocation-row", () => ({ BinAllocationRow: () => null }));
vi.mock("./feedstock-trailing-sections", () => ({ FeedstockEvidenceSection: () => null }));
vi.mock("./wet-mass-warning", () => ({ WetMassWarning: () => null }));
vi.mock("./feedstock-allocation-summary", () => ({ FeedstockAllocationSummary: () => null }));

describe("FeedstockForm intake type compatibility", () => {
  beforeEach(() => harness.reset());

  it("allows either feedstock usage through selection and inline creation", () => {
    renderToStaticMarkup(<FeedstockForm onSubmit={vi.fn()} />);

    const feedstockTypePicker = harness.entitySelects.find(
      (select) => select.name === "feedstockTypeId",
    );

    expect(feedstockTypePicker?.filterBy).toBeUndefined();
    expect(harness.feedstockTypeDialog?.defaultUsage).toBeUndefined();
    expect(harness.storageLocationDialog?.defaultFeedstockTypeId).toBe(
      "blend-feedstock-type-1",
    );
    expect(harness.storageLocationDialog).not.toHaveProperty("feedstockTypeUsage");
  });
});
