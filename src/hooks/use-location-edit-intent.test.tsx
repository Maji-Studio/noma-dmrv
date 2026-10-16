// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { expect, it, vi } from "vitest";
import { useLocationEditIntent } from "./use-location-edit-intent";

function Harness({ locations }: { locations?: { id: string }[] }) {
  const [opened, setOpened] = useState<string | null>(null);
  useLocationEditIntent(locations, location => setOpened(location.id));
  return <button onClick={() => setOpened(null)}>{opened ?? "closed"}</button>;
}

it("waits for a matching location, consumes only its intent, and stays closed on remount", async () => {
  const onUrlUpdate = vi.fn();
  const initial = "?customer=party&mode=edit&facility=facility&location=location";
  const view = render(<NuqsTestingAdapter hasMemory searchParams={initial} onUrlUpdate={onUrlUpdate}>
    <Harness />
  </NuqsTestingAdapter>);
  expect(screen.getByRole("button").textContent).toBe("closed");
  expect(onUrlUpdate).not.toHaveBeenCalled();
  view.rerender(<NuqsTestingAdapter hasMemory searchParams={initial} onUrlUpdate={onUrlUpdate}>
    <Harness locations={[{ id: "location" }]} />
  </NuqsTestingAdapter>);
  expect(screen.getByRole("button").textContent).toBe("location");
  await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
  const { searchParams } = onUrlUpdate.mock.lastCall![0];
  expect(searchParams.get("location")).toBeNull();
  expect(searchParams.get("customer")).toBe("party");
  expect(searchParams.get("facility")).toBe("facility");
  expect(searchParams.get("mode")).toBe("edit");
  await act(async () => screen.getByRole("button").click());
  expect(screen.getByRole("button").textContent).toBe("closed");
  view.unmount();
  const reopened = render(<NuqsTestingAdapter hasMemory searchParams={searchParams}>
    <Harness locations={[{ id: "location" }]} />
  </NuqsTestingAdapter>);
  expect(screen.getByRole("button").textContent).toBe("closed");
  reopened.unmount();
});
