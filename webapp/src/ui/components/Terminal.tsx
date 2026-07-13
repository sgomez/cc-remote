// Embedded web terminal (#16): xterm.js in the browser, bridged over the Nitro
// WebSocket proxy (#15 for Sessions, this issue for Login Containers) to ttyd in
// the target container. Speaks ttyd's wire protocol directly — the same one the
// live-verification client (test/ws-client.mjs) exercises:
//
//   • connect with the `tty` subprotocol
//   • on open, send a JSON init frame  {AuthToken:"", columns, rows}
//   • send keystrokes as INPUT frames    '0' + utf8 bytes   (binary)
//   • send resizes as RESIZE frames      '1' + JSON{columns,rows}
//   • server frames are command-prefixed: '0' OUTPUT (write), '1'/'2' ignored
//
// The socket is disposable and the terminal is not: xterm is created once per
// mount, and a drop only re-dials the WebSocket (policy in ~/ui/live/terminal-
// connection). Reattaching is a full recovery because ttyd runs its command once
// per client and that command is `tmux attach` onto the long-lived agent session
// — so a reconnect redraws the same Claude, and there is nothing to replay.
//
// xterm touches `window`/`document`, so it is imported dynamically inside the
// mount effect — the module stays import-safe under SSR and the terminal only
// initialises on the client.

import { useEffect, useRef, useState } from "react";
import {
  type ConnectionEvent,
  type ConnectionState,
  canRetry,
  connectionLabel,
  INITIAL_CONNECTION,
  isFailure,
  isReconnecting,
  nextConnection,
  shouldDial,
} from "~/ui/live/terminal-connection";
import "@xterm/xterm/css/xterm.css";

// ttyd command bytes. '0' (0x30) is both the client INPUT prefix and the server
// OUTPUT prefix; '1' is client RESIZE. Higher server commands (title/prefs) are
// ignored below.
const TTYD = { RESIZE: "1", CHAR_ZERO: 0x30 } as const;

function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

/**
 * Whether to put the keyboard in the terminal as soon as it connects.
 *
 * On a pointing device this is what you always want: the terminal is the reason
 * the page exists, and having to click it first is friction on every visit.
 *
 * On touch it is the opposite — focusing xterm raises the on-screen keyboard,
 * which would cover half the screen before the user has asked to type anything,
 * and this app is meant to be driven from a phone. There, tapping the terminal
 * still focuses it (xterm does that itself), which is the explicit request.
 */
function shouldAutoFocus(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
}

/** Backgrounded tab or no network: a drop now is not the link failing. */
function isAway(): boolean {
  return document.hidden || navigator.onLine === false;
}

export function Terminal({ title, wsPath }: { title: string; wsPath: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState<ConnectionState>(INITIAL_CONNECTION);
  // Lets the Reconnect button reach into the effect that owns the socket.
  const resumeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const [{ Terminal: Xterm }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !mountRef.current) return;
      const mount = mountRef.current;

      const term = new Xterm({
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 13,
        theme: { background: "#0a0e17", foreground: "#f8fafc" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(mount);
      fit.fit();

      // The connection state machine is the effect's own; React state mirrors it
      // for rendering only.
      let state: ConnectionState = INITIAL_CONNECTION;
      let ws: WebSocket | null = null;
      let retry: ReturnType<typeof setTimeout> | undefined;

      const dropSocket = () => {
        const socket = ws;
        ws = null;
        if (!socket) return;
        // Detach first: this close is ours, and must not come back as a drop.
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close(1000, "terminal reconnecting");
        } catch {
          // already closing/closed
        }
      };

      const dial = (redraw: boolean) => {
        dropSocket();
        const socket = new WebSocket(wsUrl(wsPath), ["tty"]);
        socket.binaryType = "arraybuffer";
        ws = socket;

        socket.onopen = () => {
          // The reattaching tmux client repaints the whole screen. Without a
          // reset that repaint lands *under* the frozen screen we dropped on,
          // leaving the terminal showing the stale frame with a live one below.
          if (redraw) term.reset();
          apply({ type: "opened" });
          socket.send(JSON.stringify({ AuthToken: "", columns: term.cols, rows: term.rows }));
          // Focus once the socket is up, not on mount: keystrokes typed into a
          // terminal whose socket is still connecting are dropped on the floor.
          if (shouldAutoFocus()) term.focus();
        };
        socket.onmessage = (ev) => {
          const bytes = new Uint8Array(ev.data as ArrayBuffer);
          if (bytes[0] === TTYD.CHAR_ZERO) term.write(bytes.subarray(1));
        };
        // A WebSocket `error` is always followed by `close`, so this one handler
        // covers both a failed handshake (the proxy's 401/404, which reaches the
        // browser only as an opaque 1006) and a link that died mid-session.
        socket.onclose = () => {
          if (socket !== ws) return;
          ws = null;
          apply({ type: "dropped", hidden: isAway() });
        };
      };

      const apply = (event: ConnectionEvent) => {
        const previous = state;
        state = nextConnection(previous, event);
        if (state === previous) return;
        setConnection(state);

        clearTimeout(retry);
        if (state.kind === "waiting") {
          retry = setTimeout(() => apply({ type: "retry" }), state.delayMs);
        } else if (shouldDial(state)) {
          dial(isReconnecting(state));
        }
      };

      resumeRef.current = () => apply({ type: "resumed" });
      dial(false);

      // Coming back — tab visible again, or the network returned — dials at once
      // instead of serving out a backoff scheduled for a link that is now up.
      const onWake = () => {
        if (!isAway()) apply({ type: "resumed" });
      };
      document.addEventListener("visibilitychange", onWake);
      window.addEventListener("online", onWake);

      const sendResize = () => {
        if (ws?.readyState !== WebSocket.OPEN) return;
        ws.send(`${TTYD.RESIZE}${JSON.stringify({ columns: term.cols, rows: term.rows })}`);
      };

      // Keystrokes -> INPUT frames (text prefix + utf8 bytes, sent binary).
      const enc = new TextEncoder();
      const onData = term.onData((data) => {
        if (ws?.readyState !== WebSocket.OPEN) return;
        const payload = enc.encode(data);
        const frame = new Uint8Array(payload.length + 1);
        frame[0] = TTYD.CHAR_ZERO; // ttyd INPUT prefix = '0'
        frame.set(payload, 1);
        ws.send(frame);
      });

      const onResize = () => {
        fit.fit();
        sendResize();
      };
      window.addEventListener("resize", onResize);
      const resizeSub = term.onResize(() => sendResize());

      // The mount height is CSS-driven (clamp on viewport), so a window resize
      // isn't the only thing that reflows it — observe the element itself so
      // xterm refits whenever the container's box changes.
      const ro = new ResizeObserver(onResize);
      ro.observe(mount);

      cleanup = () => {
        resumeRef.current = null;
        clearTimeout(retry);
        document.removeEventListener("visibilitychange", onWake);
        window.removeEventListener("online", onWake);
        window.removeEventListener("resize", onResize);
        ro.disconnect();
        onData.dispose();
        resizeSub.dispose();
        dropSocket();
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [wsPath]);

  return (
    <div className="terminal">
      <div className="terminal-titlebar">
        <span className="tdot tdot-r" />
        <span className="tdot tdot-y" />
        <span className="tdot tdot-g" />
        <span className="terminal-title">{title}</span>
      </div>
      <div ref={mountRef} className="terminal-mount" />
      <div className={`terminal-status ${isFailure(connection) ? "error" : ""}`}>
        <span aria-live="polite">{connectionLabel(connection)}</span>
        {canRetry(connection) && (
          <button
            type="button"
            className="terminal-reconnect"
            onClick={() => resumeRef.current?.()}
          >
            Reconnect
          </button>
        )}
      </div>
    </div>
  );
}
