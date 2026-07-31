import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedstockType } from "@/db/schema/feedstock";
import type { IsometricFeedstockType } from "@/lib/isometric";
import type { FeedstockTypeFormData } from "@/schemas/feedstock-types";
import { FeedstockTypeForm } from "./feedstock-type-form";

const ISOMETRIC_ID = "feedstock_type_selected";

const harness = vi.hoisted(() => {
  type StateSetter = (value: unknown) => void;
  type SubmitCallback = (data: Record<string, unknown>) => void;

  let stateCursor = 0;
  const stateValues: unknown[] = [];
  const stateSetters: StateSetter[] = [];

  return {
    certifierAvailable: true,
    clearDependency: undefined as string | undefined,
    formInitialized: false,
    formValues: {} as Record<string, unknown>,
    browserSelect: null as ((type: IsometricFeedstockType) => void) | null,
    submit: null as (() => void) | null,
    beginRender() {
      stateCursor = 0;
      this.browserSelect = null;
    },
    reset() {
      stateCursor = 0;
      stateValues.length = 0;
      stateSetters.length = 0;
      this.certifierAvailable = true;
      this.clearDependency = undefined;
      this.formInitialized = false;
      this.formValues = {};
      this.browserSelect = null;
      this.submit = null;
    },
    useState<T>(initialValue: T | (() => T)) {
      const index = stateCursor;
      stateCursor += 1;
      if (stateValues.length <= index) {
        stateValues[index] =
          typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      const setter: StateSetter = (value) => {
        stateValues[index] =
          typeof value === "function"
            ? (value as (previous: unknown) => unknown)(stateValues[index])
            : value;
      };
      stateSetters[index] = setter;
      return [stateValues[index] as T, setter] as const;
    },
    openIsometricSection() {
      stateSetters[0]?.("isometric");
      stateSetters[2]?.(true);
    },
    initializeForm(defaultValues: Record<string, unknown>) {
      if (this.formInitialized) return;
      this.formValues = { ...defaultValues };
      this.formInitialized = true;
    },
    captureSubmit(callback: SubmitCallback) {
      this.submit = () => callback({ ...this.formValues });
    },
  };
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: harness.useState };
});

vi.mock("react-hook-form", () => ({
  useForm: ({ defaultValues }: { defaultValues: Record<string, unknown> }) => {
    harness.initializeForm(defaultValues);
    return {
      register: (name: string) => ({ name }),
      handleSubmit: (callback: (data: Record<string, unknown>) => void) => {
        harness.captureSubmit(callback);
        return () => harness.submit?.();
      },
      control: {},
      trigger: vi.fn(),
      setValue: (name: string, value: unknown) => {
        harness.formValues[name] = value;
      },
      formState: { errors: {} },
    };
  },
  useWatch: ({ name }: { name: string }) => harness.formValues[name],
}));

vi.mock("@/components/forms", () => ({
  FormField: ({ children }: { children: React.ReactNode }) => children,
  FormInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  FormTextarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
  ResolvedErrorRevalidator: () => null,
}));

vi.mock("@/components/forms/form-select", () => ({
  FormSelect: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));

vi.mock("@/components/forms/form-actions", () => ({
  FormActions: () => <button type="submit">Submit</button>,
}));

vi.mock("@phosphor-icons/react/dist/ssr", () => ({
  DatabaseIcon: () => <span />,
  SealCheckIcon: () => <span />,
  WarningCircleIcon: () => <span />,
}));

vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ facilityId: "facility-1" }),
}));

vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: {
      mapping: harness.certifierAvailable ? { provider: "isometric" } : null,
    },
  }),
}));

vi.mock("@/hooks/use-clear-on-dependency-change", () => ({
  useClearOnDependencyChange: (
    dependency: string | undefined,
    onChange: () => void,
  ) => {
    if (
      dependency !== undefined &&
      harness.clearDependency !== undefined &&
      harness.clearDependency !== dependency
    ) {
      onChange();
    }
    harness.clearDependency = dependency;
  },
}));

vi.mock("./isometric-feedstock-browser", () => ({
  IsometricFeedstockBrowser: ({
    onSelect,
  }: {
    onSelect: (type: IsometricFeedstockType) => void;
  }) => {
    harness.browserSelect = onSelect;
    return <div>Isometric browser</div>;
  },
}));

const isometricSelection = {
  id: ISOMETRIC_ID,
  name: "Selected nutshells",
  supplier_reference_id: null,
} as IsometricFeedstockType;

const persistedFeedstockType: FeedstockType = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "org-1",
  code: "FT-001",
  name: "Persisted nutshells",
  category: "forestry",
  usage: "pyrolysis",
  description: null,
  registryUrl: null,
  isometricFeedstockTypeId: ISOMETRIC_ID,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function renderForm(props: {
  onSubmit: (data: FeedstockTypeFormData) => void;
  feedstockType?: FeedstockType;
}) {
  harness.beginRender();
  return renderToStaticMarkup(<FeedstockTypeForm {...props} />);
}

beforeEach(() => harness.reset());

describe("FeedstockTypeForm Isometric gate transitions", () => {
  it("clears a create-mode Isometric link before submit when the gate closes", () => {
    const onSubmit = vi.fn();

    renderForm({ onSubmit });
    harness.openIsometricSection();
    renderForm({ onSubmit });
    harness.browserSelect?.(isometricSelection);

    expect(harness.formValues.isometricFeedstockTypeId).toBe(ISOMETRIC_ID);

    harness.certifierAvailable = false;
    renderForm({ onSubmit });
    const closedMarkup = renderForm({ onSubmit });
    harness.submit?.();

    expect(closedMarkup).not.toContain("Selected from Isometric");
    expect(harness.formValues.isometricFeedstockTypeId).toBe("");
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ isometricFeedstockTypeId: "" }),
    );
  });

  it("preserves a persisted Isometric link in edit mode while the gate is closed", () => {
    harness.certifierAvailable = false;
    const onSubmit = vi.fn();

    renderForm({ feedstockType: persistedFeedstockType, onSubmit });
    harness.submit?.();

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ isometricFeedstockTypeId: ISOMETRIC_ID }),
    );
  });
});
