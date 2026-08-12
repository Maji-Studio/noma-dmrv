import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  isPending: false,
  modalProps: undefined as
    | {
        dismissible?: boolean;
        dismissOnClickOutside?: boolean;
        isOpen: boolean;
        onClose?: () => void;
      }
    | undefined,
  mutateAsync: vi.fn(),
  mutationCallbacks: undefined as
    | {
        onSuccess?: (
          supplier: {
            id: string;
            code: string;
            name: string;
            location: string | null;
          },
          variables: Record<string, unknown>,
        ) => void;
        onError?: (error: Error, variables: Record<string, unknown>) => void;
      }
    | undefined,
}));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();

  return {
    ...actual,
    Modal: ({
      children,
      isOpen,
      onClose,
      onOpen,
      ...props
    }: {
      children: ReactNode;
      dismissible?: boolean;
      dismissOnClickOutside?: boolean;
      isOpen: boolean;
      onClose?: () => void;
      onOpen?: () => void;
    }) => {
      const wasOpen = useRef(false);
      useEffect(() => {
        if (isOpen && !wasOpen.current) onOpen?.();
        wasOpen.current = isOpen;
      }, [isOpen, onOpen]);
      mocks.modalProps = { ...props, isOpen, onClose };
      return isOpen ? <div role="dialog">{children}</div> : null;
    },
  };
});

vi.mock("@/hooks/use-geo", () => ({
  useGeoCapabilities: () => ({ data: { routingConfigured: true } }),
  useGeocodeSearch: () => ({
    data: undefined,
    isError: false,
    isFetching: false,
  }),
  useReverseGeocode: () => ({ data: null }),
}));

vi.mock("@/hooks/use-suppliers", () => ({
  useCreateSupplierWithLocations: (
    callbacks: typeof mocks.mutationCallbacks,
  ) => {
    mocks.mutationCallbacks = callbacks;
    return {
      mutateAsync: mocks.mutateAsync,
      isPending: mocks.isPending,
    };
  },
}));

vi.mock("@/hooks/use-organization-settings", () => ({
  useOrganizationDefaultValues: () => ({
    defaults: { defaultCountry: "Switzerland" },
  }),
}));

import { SupplierQuickAddDialog } from "./supplier-quick-add-dialog";

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mocks.isPending = false;
  mocks.modalProps = undefined;
  mocks.mutateAsync.mockReset();
  mocks.mutateAsync.mockResolvedValue(undefined);
  mocks.mutationCallbacks = undefined;
});

function renderDialog({
  isOpen,
  onClose = vi.fn(),
  onSuccess = vi.fn(),
}: {
  isOpen: boolean;
  onClose?: () => void;
  onSuccess?: (supplier: {
    id: string;
    code: string;
    name: string;
    subtitle?: string;
  }) => void;
}) {
  return (
    <SupplierQuickAddDialog
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  );
}

async function changeInput(
  renderer: ReactTestRenderer,
  id: string,
  value: string,
) {
  await act(async () => {
    const input = renderer.root
      .findAllByType("input")
      .find((node) => node.props.id === id);
    input?.props.onChange({
      target: { name: input.props.name, value },
    });
  });
}

describe("SupplierQuickAddDialog", () => {
  it("submits only the validated supplier and required default location", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(renderDialog({ isOpen: false, onClose, onSuccess }));
    });
    await act(async () => {
      renderer?.update(renderDialog({ isOpen: true, onClose, onSuccess }));
    });

    const rendered = JSON.stringify(renderer?.toJSON());
    expect(rendered).toContain("New supplier");
    expect(rendered).toContain("Create supplier");
    expect(rendered).toContain("Supplier name");
    expect(rendered).toContain("Country");
    expect(rendered).toContain("GPS latitude");
    expect(rendered).toContain("GPS longitude");
    expect(rendered).not.toContain("Contact");
    expect(rendered).not.toContain("Sourcing");

    await changeInput(renderer!, "supplier-quick-add-name", "New Supplier");
    await changeInput(
      renderer!,
      "supplier-quick-add-position-latitude",
      "47.3769",
    );
    await changeInput(
      renderer!,
      "supplier-quick-add-position-longitude",
      "8.5417",
    );

    await act(async () => {
      await renderer?.root.findByType("form").props.onSubmit({
        preventDefault: () => undefined,
        persist: () => undefined,
        stopPropagation: () => undefined,
      });
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith({
      supplier: { name: "New Supplier" },
      locations: [
        {
          country: "Switzerland",
          gpsLatitude: 47.3769,
          gpsLongitude: 8.5417,
          isDefault: true,
        },
      ],
    });
    const payload = mocks.mutateAsync.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    await act(async () => {
      mocks.mutationCallbacks?.onSuccess?.({
        id: "supplier-2",
        code: "SUP-002",
        name: "New Supplier",
        location: null,
      }, payload);
    });
    expect(onSuccess).toHaveBeenCalledWith({
      id: "supplier-2",
      code: "SUP-002",
      name: "New Supplier",
      subtitle: undefined,
    });
    expect(onClose).toHaveBeenCalledOnce();

    await act(async () => renderer?.unmount());
  });

  it("resets to the organization country default on every open", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(renderDialog({ isOpen: false, onClose, onSuccess }));
    });
    await act(async () => {
      renderer?.update(renderDialog({ isOpen: true, onClose, onSuccess }));
    });

    expect(mocks.modalProps?.dismissOnClickOutside).toBe(false);
    expect(mocks.modalProps?.dismissible).toBe(true);

    await changeInput(renderer!, "supplier-quick-add-name", "Supplier");
    await changeInput(renderer!, "supplier-quick-add-country", "France");
    await changeInput(
      renderer!,
      "supplier-quick-add-position-latitude",
      "47.3769",
    );
    await changeInput(
      renderer!,
      "supplier-quick-add-position-longitude",
      "8.5417",
    );
    await act(async () => {
      await renderer?.root.findByType("form").props.onSubmit({
        preventDefault: () => undefined,
        persist: () => undefined,
        stopPropagation: () => undefined,
      });
    });
    const activePayload = mocks.mutateAsync.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    await act(async () => {
      mocks.mutationCallbacks?.onError?.(
        new Error("Supplier creation failed"),
        activePayload,
      );
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain(
      "Supplier creation failed",
    );

    await act(async () => {
      renderer?.update(renderDialog({ isOpen: false, onClose, onSuccess }));
    });
    await act(async () => {
      renderer?.update(renderDialog({ isOpen: true, onClose, onSuccess }));
    });

    expect(JSON.stringify(renderer?.toJSON())).not.toContain(
      "Supplier creation failed",
    );
    expect(mocks.modalProps?.dismissOnClickOutside).toBe(false);
    expect(mocks.modalProps?.dismissible).toBe(true);

    await changeInput(renderer!, "supplier-quick-add-name", "Reset supplier");
    await changeInput(
      renderer!,
      "supplier-quick-add-position-latitude",
      "47.3769",
    );
    await changeInput(
      renderer!,
      "supplier-quick-add-position-longitude",
      "8.5417",
    );
    await act(async () => {
      await renderer?.root.findByType("form").props.onSubmit({
        preventDefault: () => undefined,
        persist: () => undefined,
        stopPropagation: () => undefined,
      });
    });
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      supplier: { name: "Reset supplier" },
      locations: [
        {
          country: "Switzerland",
          gpsLatitude: 47.3769,
          gpsLongitude: 8.5417,
          isDefault: true,
        },
      ],
    });

    await act(async () => renderer?.unmount());
  });

  it("prevents modal dismissal while a save is pending", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    let renderer: ReactTestRenderer | undefined;

    await act(async () => {
      renderer = create(renderDialog({ isOpen: false, onClose, onSuccess }));
    });
    await act(async () => {
      renderer?.update(renderDialog({ isOpen: true, onClose, onSuccess }));
    });

    await changeInput(renderer!, "supplier-quick-add-name", "Late supplier");
    await changeInput(renderer!, "supplier-quick-add-country", "Switzerland");
    await changeInput(
      renderer!,
      "supplier-quick-add-position-latitude",
      "47.3769",
    );
    await changeInput(
      renderer!,
      "supplier-quick-add-position-longitude",
      "8.5417",
    );
    await act(async () => {
      await renderer?.root.findByType("form").props.onSubmit({
        preventDefault: () => undefined,
        persist: () => undefined,
        stopPropagation: () => undefined,
      });
    });
    const pendingPayload = mocks.mutateAsync.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;

    mocks.isPending = true;
    await act(async () => {
      renderer?.update(renderDialog({ isOpen: true, onClose, onSuccess }));
    });
    await act(async () => {
      mocks.mutationCallbacks?.onSuccess?.(
        {
          id: "supplier-late",
          code: "SUP-LATE",
          name: "Late supplier",
          location: null,
        },
        pendingPayload,
      );
    });

    expect(mocks.modalProps?.dismissible).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith({
      id: "supplier-late",
      code: "SUP-LATE",
      name: "Late supplier",
      subtitle: undefined,
    });

    await act(async () => renderer?.unmount());
  });
});
