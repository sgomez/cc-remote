// Pure, framework-free helpers for the terminal WebSocket proxy (#15). The
// crossws/ws glue in `server/routes/ws/terminal/[name].ts` stays thin by
// delegating every decision that can be tested without a socket to this module:
// subprotocol negotiation, close-code normalization, client-frame classification,
// and the buffer that holds browser frames until the upstream ttyd leg opens.

/** A terminal frame in flight between the browser and ttyd, framing preserved. */
export type UpstreamFrame = {
  data: Buffer;
  /** true = WebSocket binary frame, false = text frame. */
  isBinary: boolean;
};

/**
 * The subprotocol to echo on the 101 response, or undefined. ttyd's xterm
 * client (and clients copying it) requests the `tty` subprotocol and aborts the
 * connection unless the server echoes it back. Matches whole tokens only, so a
 * bogus `ttyx` never negotiates `tty`.
 */
export function negotiateSubprotocol(requested: string | null | undefined): string | undefined {
  const offered = requested?.split(",").map((s) => s.trim());
  return offered?.includes("tty") ? "tty" : undefined;
}

/**
 * A close code safe to re-emit to a browser. 1005 (no status) and 1006
 * (abnormal) are reserved: browsers throw if you pass them to `close()`, so an
 * upstream leg that closed with either is reported to the browser as 1000.
 */
export function normalizeCloseCode(code: number): number {
  return code === 1005 || code === 1006 ? 1000 : code;
}

/**
 * Classify a raw crossws message into an upstream frame. crossws surfaces text
 * frames as `string` and binary frames as bytes; ttyd's protocol only needs
 * that text stays text and binary stays binary.
 */
export function toUpstreamFrame(raw: string | Uint8Array): UpstreamFrame {
  if (typeof raw === "string") {
    return { data: Buffer.from(raw, "utf8"), isBinary: false };
  }
  return { data: Buffer.from(raw), isBinary: true };
}

/**
 * FIFO buffer for browser frames that arrive before the upstream ttyd
 * connection has finished opening. The bridge enqueues while the upstream leg
 * is CONNECTING and drains once on `open`; draining clears the queue so a frame
 * is never sent twice.
 */
export class PendingFrameQueue {
  private frames: UpstreamFrame[] = [];

  get size(): number {
    return this.frames.length;
  }

  enqueue(frame: UpstreamFrame): void {
    this.frames.push(frame);
  }

  /** Send every buffered frame in arrival order, then empty the queue. */
  drain(send: (frame: UpstreamFrame) => void): void {
    const pending = this.frames;
    this.frames = [];
    for (const frame of pending) send(frame);
  }
}
