// Terminal WebSocket proxy (#15): browser ⇄ webapp ⇄ ttyd in the Session's
// agent container. A Nitro server route (crossws) — WS upgrades cannot run
// through the TanStack Start fetch handler, so this MUST live under serverDir
// (server/routes/**), never src/routes.
//
// Hardened port of prototype/tanstack-terminal (issue #3): the stand-in cookie
// check becomes the real better-auth guard (#12); the hard-coded ttyd host
// becomes a label-validated Session lookup via the Docker adapter (#13) so the
// proxy never dials an arbitrary host. crossws hands us WebSocket *messages*,
// not the raw upgrade socket, so the bridge re-sends each frame on an upstream
// `ws` connection (message-level, preserving text/binary framing) — do NOT
// reuse it for bulk file transfer (no backpressure propagation).
//
// All decisions that can be tested without a socket live in the pure helpers
// (src/server/terminal-proxy.ts); this file is the thin crossws/ws glue.

import { defineWebSocketHandler } from "nitro/h3";
import { type RawData, WebSocket as UpstreamWebSocket } from "ws";
import { requireSession } from "~/adapters/auth";
import { ttydWebSocketUrl } from "~/adapters/docker";
import { isValidSessionName } from "~/core";
import { containerEngine } from "~/server/runtime";
import {
  negotiateSubprotocol,
  normalizeCloseCode,
  PendingFrameQueue,
  toUpstreamFrame,
} from "~/server/terminal-proxy";

type PeerContext = { sessionName: string };

interface Bridge {
  upstream: UpstreamWebSocket;
  /** Browser frames received before the upstream ttyd leg finished opening. */
  pending: PendingFrameQueue;
}

// peer.id -> bridge. crossws has no per-peer storage that survives the upgrade
// hook, so the bridge is keyed by peer id for the peer's lifetime.
const bridges = new Map<string, Bridge>();

function sessionNameFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
}

export default defineWebSocketHandler({
  // Runs BEFORE the 101 handshake. Every rejection throws a real HTTP Response
  // (a clean status the browser can read, not a hung/aborted socket):
  //   401 unauthenticated · 404 unknown or non-Session target.
  async upgrade(request) {
    try {
      await requireSession(request.headers);
    } catch {
      throw new Response("Unauthorized", { status: 401 });
    }

    const name = sessionNameFromUrl(request.url);
    // Format guard first: never interpolate an unvalidated name into a
    // container name / target URL.
    if (!isValidSessionName(name)) {
      throw new Response("Not Found", { status: 404 });
    }
    // Label guard: only dial containers the Docker adapter recognizes as a
    // labelled Session — never an arbitrary host on the compose network.
    const container = await containerEngine().getSessionContainer(name);
    if (!container) {
      throw new Response("Not Found", { status: 404 });
    }

    const headers: Record<string, string> = {};
    const subprotocol = negotiateSubprotocol(request.headers.get("sec-websocket-protocol"));
    if (subprotocol) headers["sec-websocket-protocol"] = subprotocol;

    return { headers, context: { sessionName: name } satisfies PeerContext };
  },

  open(peer) {
    const { sessionName } = peer.context as PeerContext;
    const upstream = new UpstreamWebSocket(ttydWebSocketUrl(sessionName), ["tty"]);
    const bridge: Bridge = { upstream, pending: new PendingFrameQueue() };
    bridges.set(peer.id, bridge);

    upstream.on("open", () => {
      bridge.pending.drain((frame) => upstream.send(frame.data, { binary: frame.isBinary }));
    });

    // ttyd -> browser. peer.send(Buffer) emits a binary frame, peer.send(string)
    // a text frame, so ttyd's framing survives the bridge.
    upstream.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        peer.send(data as Buffer);
      } else {
        peer.send((data as Buffer).toString("utf8"));
      }
    });

    upstream.on("close", (code, reason) => {
      bridges.delete(peer.id);
      peer.close(normalizeCloseCode(code), reason.toString());
    });

    upstream.on("error", () => {
      bridges.delete(peer.id);
      peer.close(1011, "terminal upstream error");
    });
  },

  // browser -> ttyd. Buffer while the upstream leg is still connecting.
  message(peer, message) {
    const bridge = bridges.get(peer.id);
    if (!bridge) return;
    const frame = toUpstreamFrame(
      typeof message.rawData === "string" ? message.rawData : message.uint8Array(),
    );
    if (bridge.upstream.readyState === UpstreamWebSocket.OPEN) {
      bridge.upstream.send(frame.data, { binary: frame.isBinary });
    } else if (bridge.upstream.readyState === UpstreamWebSocket.CONNECTING) {
      bridge.pending.enqueue(frame);
    }
  },

  close(peer) {
    const bridge = bridges.get(peer.id);
    bridges.delete(peer.id);
    if (!bridge) return;
    if (bridge.upstream.readyState === UpstreamWebSocket.OPEN) {
      bridge.upstream.close(1000, "client left");
    } else {
      bridge.upstream.terminate();
    }
  },

  error(peer) {
    bridges.get(peer.id)?.upstream.terminate();
    bridges.delete(peer.id);
  },
});
