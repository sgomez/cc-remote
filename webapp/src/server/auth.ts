// Client-safe session fetch (#16). `fetchSession` is the ONLY export here, so
// the TanStack Start compiler strips its handler — and the server-only `auth`
// import it pulls in (better-auth + better-sqlite3, which runs `new Database()`
// at module load) — entirely out of the client bundle, leaving a plain RPC stub
// the route guards call. Importing the equivalent helper from the mixed
// ~/adapters/auth module instead drags all of better-auth into the browser
// (~470 KB) and crashes on load, so route `beforeLoad` guards MUST import from
// here.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "~/adapters/auth/auth";

export const fetchSession = createServerFn({ method: "GET" }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});
