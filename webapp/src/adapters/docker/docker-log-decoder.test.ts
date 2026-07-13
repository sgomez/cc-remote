import { describe, expect, it } from "vitest";
import { createDockerLogDecoder } from "./docker-log-decoder";

/** One Docker multiplexed frame (the non-TTY wire format). */
function frame(type: number, text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/** Feed a buffer to the decoder one byte at a time — the worst-case chunking. */
function pushPerByte(decoder: ReturnType<typeof createDockerLogDecoder>, buf: Buffer): string {
  let out = "";
  for (const byte of buf) out += decoder.push(Buffer.from([byte]));
  return out + decoder.flush();
}

describe("createDockerLogDecoder (TTY: raw stream)", () => {
  it("passes raw bytes straight through", () => {
    const d = createDockerLogDecoder(true);

    expect(d.push(Buffer.from("hello ", "utf8"))).toBe("hello ");
    expect(d.push(Buffer.from("agent\n", "utf8"))).toBe("agent\n");
  });

  // The failure this exists to prevent: a chunk boundary through the middle of a
  // multi-byte character would otherwise emit a replacement char.
  it("carries a multi-byte character split across chunks", () => {
    const d = createDockerLogDecoder(true);
    const utf8 = Buffer.from("café ✓\n", "utf8");

    expect(pushPerByte(d, utf8)).toBe("café ✓\n");
  });

  it("keeps ANSI escapes intact (sanitizing is the core's job)", () => {
    const d = createDockerLogDecoder(true);
    const ansi = "[32mready[0m\r\n";

    expect(d.push(Buffer.from(ansi, "utf8"))).toBe(ansi);
  });
});

describe("createDockerLogDecoder (non-TTY: framed stream)", () => {
  it("strips the frame headers, concatenating stdout and stderr", () => {
    const d = createDockerLogDecoder(false);
    const buf = Buffer.concat([frame(1, "cloning\n"), frame(2, "fatal: nope\n")]);

    expect(d.push(buf)).toBe("cloning\nfatal: nope\n");
  });

  // The header itself can straddle a chunk boundary — the case a one-shot read
  // never meets and the one that leaks framing bytes if you get it wrong.
  it("reassembles a frame header split across chunks", () => {
    const d = createDockerLogDecoder(false);
    const buf = frame(1, "split header\n");

    expect(d.push(buf.subarray(0, 3))).toBe("");
    expect(d.push(buf.subarray(3))).toBe("split header\n");
  });

  it("reassembles a payload split across chunks", () => {
    const d = createDockerLogDecoder(false);
    const buf = frame(1, "a long payload line\n");

    expect(d.push(buf.subarray(0, 12))).toBe("");
    expect(d.push(buf.subarray(12))).toBe("a long payload line\n");
  });

  it("survives byte-at-a-time delivery of several frames", () => {
    const d = createDockerLogDecoder(false);
    const buf = Buffer.concat([frame(1, "one\n"), frame(2, "two\n"), frame(1, "café ✓\n")]);

    const out = pushPerByte(d, buf);

    expect(out).toBe("one\ntwo\ncafé ✓\n");
    expect(out).not.toContain("\u0000");
    expect(out).not.toContain("\u0001");
  });

  it("holds an incomplete trailing frame rather than emitting junk", () => {
    const d = createDockerLogDecoder(false);
    const buf = Buffer.concat([frame(1, "complete\n"), frame(1, "truncated").subarray(0, 10)]);

    const out = d.push(buf);

    expect(out).toBe("complete\n");
    expect(out).not.toContain("trunc");
  });

  it("emits nothing for an empty stream", () => {
    const d = createDockerLogDecoder(false);

    expect(d.push(Buffer.alloc(0))).toBe("");
    expect(d.flush()).toBe("");
  });
});
