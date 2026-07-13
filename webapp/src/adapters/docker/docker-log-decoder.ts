// Stateful decoder for a FOLLOWED Docker log stream.
//
// The one-shot read (`decodeDockerLogs`) gets the whole body at once and can
// sniff whether it is framed. A follow cannot: bytes arrive in arbitrary chunks,
// so an 8-byte frame header — or a multi-byte UTF-8 character — can straddle a
// chunk boundary. This decoder keeps the leftovers.
//
// It doesn't sniff, either: the container's `Tty` flag (from inspect) is
// authoritative about which wire format Docker will send. TTY containers (all of
// ours — see container-specs.ts) stream raw bytes; a non-TTY container streams
// frames of `[stream type, 0, 0, 0, big-endian uint32 length]` + payload.

import { StringDecoder } from "node:string_decoder";

export type DockerLogDecoder = {
  /** Decode a chunk, holding back any incomplete frame/character. */
  push(chunk: Buffer): string;
  /** Decode whatever is left when the stream ends. */
  flush(): string;
};

const HEADER_SIZE = 8;

export function createDockerLogDecoder(tty: boolean): DockerLogDecoder {
  // One StringDecoder across the whole stream: it is what carries a multi-byte
  // character split across two chunks (or two frames) over the boundary.
  const utf8 = new StringDecoder("utf8");

  if (tty) {
    return {
      push: (chunk) => utf8.write(chunk),
      flush: () => utf8.end(),
    };
  }

  let leftover = Buffer.alloc(0);

  return {
    push(chunk: Buffer): string {
      let buffer = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
      let out = "";
      let offset = 0;

      while (offset + HEADER_SIZE <= buffer.length) {
        const size = buffer.readUInt32BE(offset + 4);
        const start = offset + HEADER_SIZE;
        // The frame is still arriving — keep it whole for the next chunk.
        if (start + size > buffer.length) break;
        out += utf8.write(buffer.subarray(start, start + size));
        offset = start + size;
      }

      buffer = buffer.subarray(offset);
      leftover = buffer.length > 0 ? Buffer.from(buffer) : Buffer.alloc(0);
      return out;
    },

    flush(): string {
      // A truncated trailing frame (the container died mid-write) has no payload
      // we can trust, so only the decoder's pending bytes are worth emitting.
      leftover = Buffer.alloc(0);
      return utf8.end();
    },
  };
}
