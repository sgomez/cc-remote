// Live verification client for the terminal WebSocket proxy + status SSE (#15).
// The adapted descendant of prototype/tanstack-terminal's ws-client.mjs, run
// against the REAL routes (auth + Docker label validation), NOT the prototype's
// stand-in. Not a CI test — it needs a running server, a real ttyd Session
// container, and a real auth cookie. The pure logic is unit-tested in vitest;
// this proves the socket/SSE glue end to end, in `vite dev` AND the prod build.
//
// Setup (dev example):
//   1. Start a ttyd agent container LABELLED as a Session named `demo`, reachable
//      from the webapp as `cc-remote-session-demo:7681` (join the compose network
//      or add a network alias). The agent image already runs
//      `ttyd -p 7681 --base-path /api/sessions/demo/terminal ...`; for a bare
//      stand-in: `docker run -d --name cc-remote-session-demo \
//        --network <webapp-net> \
//        -l cc-remote-session=true -l cc-remote-session-name=demo \
//        tsl0922/ttyd:latest ttyd -W -p 7681 \
//        --base-path /api/sessions/demo/terminal bash`
//   2. Log in through the browser and copy the better-auth session cookie.
//   3. Run:
//      BASE=http://localhost:3000 SESSION=demo \
//        COOKIE='better-auth.session_token=...' node test/ws-client.mjs
//
// Checks (9): WS 401 unauth · authenticated upgrade · subprotocol echo ·
// bidirectional data (bash executed) · server->client binary framing ·
// flood-volume integrity · clean close · SSE progressive · SSE 401.
import { WebSocket } from "ws";

const BASE = process.env.BASE ?? "http://localhost:3000";
const WS_BASE = BASE.replace(/^http/, "ws");
const SESSION = process.env.SESSION ?? "demo";
const COOKIE = process.env.COOKIE ?? "";
const MARKER = `proxy-roundtrip-${Date.now()}`;
const FLOOD_LINES = 10000;

if (!COOKIE) {
  console.error("Set COOKIE to a valid better-auth session cookie (see file header).");
  process.exit(2);
}

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

// --- 1. unauthenticated upgrade is rejected with HTTP 401 -------------------
await new Promise((resolve) => {
  const ws = new WebSocket(`${WS_BASE}/ws/terminal/${SESSION}`, ["tty"]);
  ws.on("open", () => {
    ok("reject upgrade without cookie", false, "connection opened!");
    ws.close();
    resolve();
  });
  ws.on("unexpected-response", (_req, res) => {
    ok("reject upgrade without cookie", res.statusCode === 401, `HTTP ${res.statusCode}`);
    resolve();
  });
  ws.on("error", () => resolve());
});

// --- 2..7. authenticated upgrade, subprotocol, data, flood, clean close -----
await new Promise((resolve) => {
  const ws = new WebSocket(`${WS_BASE}/ws/terminal/${SESSION}`, ["tty"], {
    headers: { cookie: COOKIE },
  });
  const timer = setTimeout(() => {
    ok("terminal roundtrip", false, "timeout waiting for output");
    ws.terminate();
    resolve();
  }, 20_000);

  let output = "";
  let sawBinary = false;
  let phase = "echo";

  ws.on("open", () => {
    ok("authenticated upgrade accepted", true);
    ok("subprotocol echoed", ws.protocol === "tty", `got '${ws.protocol}'`);
    // ttyd handshake: JSON init (text), then INPUT frames ('0'+data, binary).
    ws.send(JSON.stringify({ AuthToken: "", columns: 120, rows: 30 }));
    setTimeout(() => ws.send(Buffer.from(`0echo ${MARKER}\r`, "utf8")), 300);
  });

  ws.on("message", (data, isBinary) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.concat(data);
    if (isBinary) sawBinary = true;
    if (buf[0] === 0x30 /* '0' OUTPUT */) output += buf.slice(1).toString("utf8");

    // The marker appears twice (pty echo + command stdout) => bash ran it.
    if (phase === "echo" && output.split(MARKER).length > 2) {
      phase = "flood";
      ok("bidirectional terminal data (bash executed command)", true);
      ok("server->client frames are binary", sawBinary);
      output = "";
      // Emit a large, self-describing payload to prove no frames are dropped.
      ws.send(Buffer.from(`0seq 1 ${FLOOD_LINES} | sed 's/^/L/'\r`, "utf8"));
    } else if (phase === "flood") {
      const lines = output.match(/^L\d+$/gm) ?? [];
      if (lines.includes(`L${FLOOD_LINES}`)) {
        phase = "closing";
        clearTimeout(timer);
        const complete = lines.length >= FLOOD_LINES;
        ok("flood-volume integrity (all lines intact)", complete, `${lines.length} lines`);
        ws.close(1000, "test done");
      }
    }
  });

  ws.on("close", (code) => {
    ok("clean close handshake completed", phase === "closing" && code === 1000, `code ${code}`);
    resolve();
  });
  ws.on("error", (err) => {
    ok("terminal websocket", false, err.message);
    resolve();
  });
});

// --- 8 + 9. SSE status stream: progressive + auth-guarded -------------------
{
  const res = await fetch(`${BASE}/api/sessions/status`, { headers: { cookie: COOKIE } });
  ok(
    "SSE responds 200 with event-stream",
    res.status === 200 && /event-stream/.test(res.headers.get("content-type") ?? ""),
    `${res.status} ${res.headers.get("content-type")}`,
  );

  const t0 = Date.now();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let chunks = 0;
  let sawData = false;
  // Read for ~2.5s: an initial payload should arrive fast, then heartbeats/
  // updates keep coming — proving the stream flushes progressively, not buffered.
  while (Date.now() - t0 < 2500) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = dec.decode(value);
    if (text.length) chunks++;
    if (/^(event:|data:)/m.test(text)) sawData = true;
  }
  reader.cancel().catch(() => {});
  ok(
    "SSE streamed progressively (not buffered)",
    sawData && chunks >= 2 && Date.now() - t0 >= 2000,
    `${chunks} flushes in ${Date.now() - t0}ms`,
  );

  const unauth = await fetch(`${BASE}/api/sessions/status`);
  ok("SSE rejects without cookie", unauth.status === 401, `HTTP ${unauth.status}`);
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
