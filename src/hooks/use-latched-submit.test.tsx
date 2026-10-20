// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useForm } from "react-hook-form";
import { useLatchedSubmit } from "./use-latched-submit";

afterEach(cleanup);

it("blocks a second submit synchronously and allows a new entry after completion", async () => {
  const { result, rerender } = renderHook(useLatchedSubmit);
  let resolve!: () => void;
  const handler = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  const first = result.current(handler)({ preventDefault: vi.fn() });
  rerender();
  const blocked = { preventDefault: vi.fn() };
  await result.current(handler)(blocked);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(blocked.preventDefault).toHaveBeenCalledOnce();
  resolve();
  await first;
  const next = result.current(handler)({ preventDefault: vi.fn() });
  expect(handler).toHaveBeenCalledTimes(2);
  resolve();
  await next;
});

it("releases after a rejected submission", async () => {
  const { result } = renderHook(useLatchedSubmit);
  const handler = vi.fn().mockRejectedValueOnce(new Error("Save failed")).mockResolvedValue(undefined);
  const submit = result.current(handler);
  await expect(submit({ preventDefault: vi.fn() })).rejects.toThrow("Save failed");
  await submit({ preventDefault: vi.fn() });
  expect(handler).toHaveBeenCalledTimes(2);
});

it("releases after RHF validation fails so corrected input can submit", async () => {
  const valid = vi.fn();
  const invalid = vi.fn();
  const { result } = renderHook(() => {
    const form = useForm({ defaultValues: { name: "" } });
    form.register("name", { required: true });
    const latched = useLatchedSubmit();
    return { form, submit: latched(() => form.handleSubmit(valid, invalid)()) };
  });
  await result.current.submit({ preventDefault: vi.fn() });
  expect(invalid).toHaveBeenCalledOnce();
  expect(valid).not.toHaveBeenCalled();
  result.current.form.setValue("name", "New entry");
  await result.current.submit({ preventDefault: vi.fn() });
  expect(valid).toHaveBeenCalledOnce();
});
