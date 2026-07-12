import { describe, expect, it } from "vitest";
import { ChangeTracker, formatSseComment, formatSseEvent } from "./sse";

describe("formatSseEvent", () => {
  it("serializes a named event with JSON data and the blank-line terminator", () => {
    expect(formatSseEvent("status", { phase: "running" })).toBe(
      'event: status\ndata: {"phase":"running"}\n\n',
    );
  });

  it("serializes arrays and scalars as JSON", () => {
    expect(formatSseEvent("sessions", [{ name: "a" }])).toBe(
      'event: sessions\ndata: [{"name":"a"}]\n\n',
    );
  });
});

describe("formatSseComment", () => {
  it("emits an SSE comment line (heartbeat) that clients ignore", () => {
    expect(formatSseComment("ping")).toBe(": ping\n\n");
  });
});

describe("ChangeTracker", () => {
  it("reports the first value as changed, then only on a different value", () => {
    const tracker = new ChangeTracker();
    expect(tracker.changed([{ name: "a", status: "running" }])).toBe(true);
    expect(tracker.changed([{ name: "a", status: "running" }])).toBe(false);
    expect(tracker.changed([{ name: "a", status: "stopped" }])).toBe(true);
    expect(tracker.changed([{ name: "a", status: "stopped" }])).toBe(false);
  });

  it("is order-sensitive only as far as JSON is (callers pass stable order)", () => {
    const tracker = new ChangeTracker();
    expect(tracker.changed([{ id: 1 }, { id: 2 }])).toBe(true);
    expect(tracker.changed([{ id: 2 }, { id: 1 }])).toBe(true);
  });
});
