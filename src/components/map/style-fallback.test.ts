import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import { BLANK_BASEMAP_STYLE } from "@/config/geo";
import { armBasemapFallback } from "./style-fallback";

const TIMEOUT_MS = 1000;

type Handler = () => void;

/** Minimal map: on/once/off keyed by event name, plus a setStyle spy. */
function fakeMap() {
  const handlers = new Map<string, Set<Handler>>();
  const add = (event: string, handler: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)?.add(handler);
  };
  const map = {
    on: vi.fn(add),
    once: vi.fn(add),
    off: vi.fn((event: string, handler: Handler) => handlers.get(event)?.delete(handler)),
    setStyle: vi.fn(),
  };
  const emit = (event: string) => [...(handlers.get(event) ?? [])].forEach((h) => h());
  const count = (event: string) => handlers.get(event)?.size ?? 0;
  return { map: map as unknown as MapLibreMap, spy: map, emit, count };
}

describe("armBasemapFallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("falls back once when the style never loads", () => {
    const { map, spy } = fakeMap();
    const onFallback = vi.fn();
    armBasemapFallback(map, onFallback, TIMEOUT_MS);
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(spy.setStyle).toHaveBeenCalledTimes(1);
    expect(spy.setStyle).toHaveBeenCalledWith(BLANK_BASEMAP_STYLE);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("falls back once on an error before the style parses", () => {
    const { map, spy, emit } = fakeMap();
    const onFallback = vi.fn();
    armBasemapFallback(map, onFallback, TIMEOUT_MS);
    emit("error");
    emit("error");
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    expect(spy.setStyle).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("ignores an error after the style parsed (a tile error)", () => {
    const { map, spy, emit } = fakeMap();
    const onFallback = vi.fn();
    armBasemapFallback(map, onFallback, TIMEOUT_MS);
    emit("styledata");
    emit("error");
    expect(onFallback).not.toHaveBeenCalled();
    expect(spy.setStyle).not.toHaveBeenCalled();
  });

  it("does nothing after load and clears the timer", () => {
    const { map, spy, emit, count } = fakeMap();
    const onFallback = vi.fn();
    armBasemapFallback(map, onFallback, TIMEOUT_MS);
    emit("load");
    expect(vi.getTimerCount()).toBe(0);
    expect(count("error")).toBe(0);
    vi.advanceTimersByTime(TIMEOUT_MS * 2);
    emit("error");
    expect(spy.setStyle).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });
});
