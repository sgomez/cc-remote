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
// xterm touches `window`/`document`, so it is imported dynamically inside the
// mount effect — the module stays import-safe under SSR and the terminal only
// initialises on the client.

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

// ttyd command bytes. '0' (0x30) is both the client INPUT prefix and the server
// OUTPUT prefix; '1' is client RESIZE. Higher server commands (title/prefs) are
// ignored below.
const TTYD = { RESIZE: "1", CHAR_ZERO: 0x30 } as const;

function wsUrl(path: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

export function Terminal({ title, wsPath }: { title: string; wsPath: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");

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

      const ws = new WebSocket(wsUrl(wsPath), ["tty"]);
      ws.binaryType = "arraybuffer";

      const sendResize = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(`${TTYD.RESIZE}${JSON.stringify({ columns: term.cols, rows: term.rows })}`);
      };

      ws.onopen = () => {
        setStatus("open");
        ws.send(JSON.stringify({ AuthToken: "", columns: term.cols, rows: term.rows }));
      };
      ws.onmessage = (ev) => {
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        if (bytes[0] === TTYD.CHAR_ZERO) term.write(bytes.subarray(1));
      };
      ws.onclose = () => setStatus((s) => (s === "error" ? s : "closed"));
      ws.onerror = () => setStatus("error");

      // Keystrokes -> INPUT frames (text prefix + utf8 bytes, sent binary).
      const enc = new TextEncoder();
      const onData = term.onData((data) => {
        if (ws.readyState !== WebSocket.OPEN) return;
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
        window.removeEventListener("resize", onResize);
        ro.disconnect();
        onData.dispose();
        resizeSub.dispose();
        try {
          ws.close(1000, "component unmounted");
        } catch {
          // already closing/closed
        }
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [wsPath]);

  const statusText: Record<typeof status, string> = {
    connecting: "connecting…",
    open: "connected",
    closed: "disconnected",
    error: "connection error",
  };

  return (
    <div className="terminal">
      <div className="terminal-titlebar">
        <span className="tdot tdot-r" />
        <span className="tdot tdot-y" />
        <span className="tdot tdot-g" />
        <span className="terminal-title">{title}</span>
      </div>
      <div ref={mountRef} className="terminal-mount" />
      <div className={`terminal-status ${status === "error" ? "error" : ""}`}>
        {statusText[status]}
      </div>
    </div>
  );
}
