// Manual smoke test for the placeholder Nitro WS route. Not run in CI (it
// needs a running server). Start the app, then:
//
//   pnpm dev                                  # or: pnpm build && pnpm start
//   BASE=http://localhost:3000 node test/ws-smoke.mjs
//
// Verifies the WS route accepts a connection and echoes a frame, in both dev
// and the production build.
import { WebSocket } from "ws";

const BASE = process.env.BASE ?? "http://localhost:3000";
const WS_BASE = BASE.replace(/^http/, "ws");
const PAYLOAD = `echo-${Date.now()}`;

let failures = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

await new Promise((resolve) => {
  const ws = new WebSocket(`${WS_BASE}/ws/terminal/demo`);
  const timer = setTimeout(() => {
    ok("ws echo roundtrip", false, "timeout");
    ws.terminate();
    resolve();
  }, 10_000);

  let sawConnected = false;

  ws.on("open", () => ws.send(PAYLOAD));
  ws.on("message", (data) => {
    const text = data.toString("utf8");
    if (text.startsWith("connected:")) {
      sawConnected = true;
      return;
    }
    if (text === PAYLOAD) {
      clearTimeout(timer);
      ok("ws upgrade + greeting", sawConnected);
      ok("ws echoes the sent frame", true);
      ws.close(1000, "smoke done");
    }
  });
  ws.on("close", () => resolve());
  ws.on("error", (err) => {
    ok("ws connection", false, err.message);
    resolve();
  });
});

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
