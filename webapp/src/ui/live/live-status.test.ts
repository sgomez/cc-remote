import { afterEach, describe, expect, it, vi } from "vitest";
import { commitWithTransition, parseNextSnapshot } from "./live-status";

describe("parseNextSnapshot", () => {
  it("parses a fresh payload into a snapshot value", () => {
    expect(parseNextSnapshot('{"phase":"running"}', undefined)).toEqual({
      value: { phase: "running" },
    });
  });

  it("skips a payload byte-for-byte identical to the last applied one", () => {
    const data = '[{"name":"a","status":"running"}]';
    expect(parseNextSnapshot(data, data)).toBeNull();
  });

  it("re-applies when the same shape arrives with different bytes", () => {
    const prev = '{"status":"cloning"}';
    expect(parseNextSnapshot('{"status":"running"}', prev)).toEqual({
      value: { status: "running" },
    });
  });

  it("skips unparseable payloads instead of throwing", () => {
    expect(parseNextSnapshot("not json", undefined)).toBeNull();
  });
});

describe("commitWithTransition", () => {
  const realDocument = globalThis.document;
  const realWindow = globalThis.window;

  afterEach(() => {
    if (realDocument === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      globalThis.document = realDocument;
    }
    if (realWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      globalThis.window = realWindow;
    }
  });

  function stubEnv(opts: { reduceMotion: boolean }): { startViewTransition: ReturnType<typeof vi.fn> } {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    // @ts-expect-error minimal document stub for the transition path
    globalThis.document = { startViewTransition };
    // @ts-expect-error minimal window stub for the reduced-motion query
    globalThis.window = {
      matchMedia: (query: string) => ({ matches: opts.reduceMotion && query.includes("reduce") }),
    };
    return { startViewTransition };
  }

  it("wraps the mutation in a view transition when motion is allowed", () => {
    const { startViewTransition } = stubEnv({ reduceMotion: false });
    const mutate = vi.fn();
    commitWithTransition(mutate);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("mutates directly, without a transition, when reduced motion is preferred", () => {
    const { startViewTransition } = stubEnv({ reduceMotion: true });
    const mutate = vi.fn();
    commitWithTransition(mutate);
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
