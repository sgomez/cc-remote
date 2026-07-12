import { describe, expect, it } from "vitest";
import {
  negotiateSubprotocol,
  normalizeCloseCode,
  PendingFrameQueue,
  toUpstreamFrame,
} from "./terminal-proxy";

describe("negotiateSubprotocol", () => {
  it("echoes 'tty' when the client requests it (ttyd's xterm client aborts otherwise)", () => {
    expect(negotiateSubprotocol("tty")).toBe("tty");
  });

  it("finds 'tty' among a comma-separated list, trimming whitespace", () => {
    expect(negotiateSubprotocol("foo, tty ,bar")).toBe("tty");
  });

  it("returns undefined when 'tty' was not requested or the header is absent", () => {
    expect(negotiateSubprotocol("chat")).toBeUndefined();
    expect(negotiateSubprotocol("")).toBeUndefined();
    expect(negotiateSubprotocol(null)).toBeUndefined();
  });

  it("does not match a substring like 'ttyx'", () => {
    expect(negotiateSubprotocol("ttyx")).toBeUndefined();
  });
});

describe("normalizeCloseCode", () => {
  it("passes through legal application close codes", () => {
    expect(normalizeCloseCode(1000)).toBe(1000);
    expect(normalizeCloseCode(1011)).toBe(1011);
    expect(normalizeCloseCode(4000)).toBe(4000);
  });

  it("rewrites the reserved 1005/1006 codes to 1000 (browsers reject re-emitting them)", () => {
    expect(normalizeCloseCode(1005)).toBe(1000);
    expect(normalizeCloseCode(1006)).toBe(1000);
  });
});

describe("toUpstreamFrame", () => {
  it("keeps text frames as UTF-8 text", () => {
    const frame = toUpstreamFrame("hello");
    expect(frame.isBinary).toBe(false);
    expect(frame.data.toString("utf8")).toBe("hello");
  });

  it("keeps binary frames binary, preserving bytes", () => {
    const bytes = new Uint8Array([0x30, 0x01, 0xff]);
    const frame = toUpstreamFrame(bytes);
    expect(frame.isBinary).toBe(true);
    expect([...frame.data]).toEqual([0x30, 0x01, 0xff]);
  });
});

describe("PendingFrameQueue", () => {
  it("buffers frames until drained, preserving order and framing", () => {
    const queue = new PendingFrameQueue();
    queue.enqueue(toUpstreamFrame("a"));
    queue.enqueue(toUpstreamFrame(new Uint8Array([1, 2])));
    expect(queue.size).toBe(2);

    const sent: Array<{ text?: string; bytes?: number[]; isBinary: boolean }> = [];
    queue.drain((frame) => {
      sent.push(
        frame.isBinary
          ? { bytes: [...frame.data], isBinary: true }
          : { text: frame.data.toString("utf8"), isBinary: false },
      );
    });

    expect(sent).toEqual([
      { text: "a", isBinary: false },
      { bytes: [1, 2], isBinary: true },
    ]);
  });

  it("empties itself after draining so a flush never re-sends", () => {
    const queue = new PendingFrameQueue();
    queue.enqueue(toUpstreamFrame("x"));
    queue.drain(() => {});
    expect(queue.size).toBe(0);

    let calls = 0;
    queue.drain(() => calls++);
    expect(calls).toBe(0);
  });
});
