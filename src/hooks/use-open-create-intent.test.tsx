import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { isCreateIntentValue } from "@/lib/create-intent";
import { useOpenCreateIntent } from "./use-open-create-intent";

vi.mock("next/navigation", () => ({
  usePathname: () => "/samples",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function Harness({
  initialOpen,
  initialContext,
}: {
  initialOpen: boolean;
  initialContext?: string;
}) {
  const intent = useOpenCreateIntent({
    initialOpen,
    initialContext,
    contextParam: "creditBatch",
  });
  return intent.isOpen ? (
    <div data-context={intent.context ?? ""}>Create sheet open</div>
  ) : (
    <div>Create sheet closed</div>
  );
}

describe("useOpenCreateIntent", () => {
  it("renders a server-parsed hard-entry create intent open immediately", () => {
    const html = renderToStaticMarkup(
      <Harness initialOpen initialContext="batch-1" />,
    );

    expect(html).toContain("Create sheet open");
    expect(html).toContain('data-context="batch-1"');
  });

  it("keeps an ordinary page closed without create intent", () => {
    expect(renderToStaticMarkup(<Harness initialOpen={false} />)).toContain(
      "Create sheet closed",
    );
  });
});

describe("isCreateIntentValue", () => {
  it.each(["true", "1", ["true"]])("accepts %j", (value) => {
    expect(isCreateIntentValue(value)).toBe(true);
  });

  it.each([undefined, null, "false", "0", ["false"]])(
    "rejects %j",
    (value) => {
      expect(isCreateIntentValue(value)).toBe(false);
    },
  );
});
