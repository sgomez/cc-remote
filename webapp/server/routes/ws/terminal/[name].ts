// Placeholder Nitro WebSocket route. Proves the crossws plumbing builds and
// runs in BOTH `vite dev` and the production build
// (`node .output/server/index.mjs`).
//
// It is a bare echo: no auth, no upstream ttyd leg yet. The authenticated
// message-level bridge to `ws://cc-remote-session-<name>:7681/ws` (the real
// terminal proxy) arrives in issue #15 — see prototype/tanstack-terminal for
// the proven bridge implementation.
//
// WS handlers MUST live under the Nitro serverDir (server/routes/**); TanStack
// Start routes (src/routes/**) go through the fetch handler and cannot upgrade.

import { defineWebSocketHandler } from "nitro/h3";

export default defineWebSocketHandler({
  open(peer) {
    const name = new URL(peer.request?.url ?? "http://local/").pathname.split("/").pop();
    peer.send(`connected:${name ?? ""}`);
  },

  message(peer, message) {
    // Echo the frame straight back, preserving text/binary framing.
    const raw = message.rawData;
    if (typeof raw === "string") {
      peer.send(raw);
    } else {
      peer.send(Buffer.from(message.uint8Array()));
    }
  },
});
