// Login-Container terminal WebSocket proxy (#16): browser ⇄ webapp ⇄ ttyd in an
// OAuth Account's ephemeral Login Container. The login analogue of the session
// terminal proxy (server/routes/ws/terminal/[name].ts) — same crossws/ws bridge
// and the same pure helpers (src/server/terminal-proxy.ts), differing only in
// the label guard (a login-labelled container, not a session) and the upstream
// target (loginTtydWebSocketUrl). Must live under serverDir: WS upgrades cannot
// run through the TanStack Start fetch handler.

import { defineWebSocketHandler } from "nitro/h3";
import { type RawData, WebSocket as UpstreamWebSocket } from "ws";
import { requireSession } from "~/adapters/auth";
import { loginTtydWebSocketUrl } from "~/adapters/docker";
import { containerEngine } from "~/server/runtime";
import {
  negotiateSubprotocol,
  normalizeCloseCode,
  PendingFrameQueue,
  toUpstreamFrame,
} from "~/server/terminal-proxy";

type PeerContext = { accountId: string };

interface Bridge {
  upstream: UpstreamWebSocket;
  pending: PendingFrameQueue;
}

const bridges = new Map<string, Bridge>();

// UUID-shaped (or otherwise token-safe) account ids only — never interpolate an
// unvalidated id into a container name / target URL.
const ACCOUNT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function accountIdFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
}

export default defineWebSocketHandler({
  async upgrade(request) {
    try {
      await requireSession(request.headers);
    } catch {
      throw new Response("Unauthorized", { status: 401 });
    }

    const accountId = accountIdFromUrl(request.url);
    if (!ACCOUNT_ID_RE.test(accountId)) {
      throw new Response("Not Found", { status: 404 });
    }
    // Label guard: only dial a container the Docker adapter recognizes as this
    // Account's Login Container — never an arbitrary host on the compose network.
    const container = await containerEngine().getLoginContainer(accountId);
    if (container?.state !== "running") {
      throw new Response("Not Found", { status: 404 });
    }

    const headers: Record<string, string> = {};
    const subprotocol = negotiateSubprotocol(request.headers.get("sec-websocket-protocol"));
    if (subprotocol) headers["sec-websocket-protocol"] = subprotocol;

    return { headers, context: { accountId } satisfies PeerContext };
  },

  open(peer) {
    const { accountId } = peer.context as PeerContext;
    const upstream = new UpstreamWebSocket(loginTtydWebSocketUrl(accountId), ["tty"]);
    const bridge: Bridge = { upstream, pending: new PendingFrameQueue() };
    bridges.set(peer.id, bridge);

    upstream.on("open", () => {
      bridge.pending.drain((frame) => upstream.send(frame.data, { binary: frame.isBinary }));
    });

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
      peer.close(1011, "login terminal upstream error");
    });
  },

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
