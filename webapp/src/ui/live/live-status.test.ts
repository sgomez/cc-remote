import { afterEach, describe, expect, it, vi } from "vitest";
import { commitWithTransition, parseNextSnapshot, snapshotKey } from "./live-status";

describe("parseNextSnapshot", () => {
  it("parses a fresh payload into a snapshot value plus its dedup key", () => {
    expect(parseNextSnapshot('{"phase":"running"}', undefined)).toEqual({
      value: { phase: "running" },
      key: '{"phase":"running"}',
    });
  });

  it("skips a payload carrying no change from the last applied snapshot", () => {
    const data = '[{"name":"a","status":"running"}]';
    expect(parseNextSnapshot(data, snapshotKey(JSON.parse(data)))).toBeNull();
  });

  // The regression this guards: on mount the stream replays the snapshot the
  // loader already rendered. Committing it would open a second view transition
  // that cancels the router's in-flight navigation transition, so navigations
  // appeared to have no transition at all.
  it("skips the stream's opening replay of the loader-seeded snapshot", () => {
    const seeded = [{ name: "api", status: "running" }];
    const replay = '[{"name":"api","status":"running"}]';
    expect(parseNextSnapshot(replay, snapshotKey(seeded))).toBeNull();
  });

  it("ignores formatting differences that carry no change", () => {
    const seeded = { status: "running" };
    expect(parseNextSnapshot('{ "status" : "running" }', snapshotKey(seeded))).toBeNull();
  });

  it("applies a payload that really changes the snapshot", () => {
    const prev = snapshotKey({ status: "cloning" });
    expect(parseNextSnapshot('{"status":"running"}', prev)).toEqual({
      value: { status: "running" },
      key: '{"status":"running"}',
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

  function stubEnv(opts: { reduceMotion: boolean }): {
    startViewTransition: ReturnType<typeof vi.fn>;
  } {
    const startViewTransition = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    // @ts-expect-error minimal document stub for the transition path
    globalThis.document = { startViewTransition };
    // Minimal window stub for the reduced-motion query.
    globalThis.window = {
      matchMedia: (query: string) =>
        ({ matches: opts.reduceMotion && query.includes("reduce") }) as MediaQueryList,
    } as unknown as Window & typeof globalThis;
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
