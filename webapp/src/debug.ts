// Thin wrapper over the `debug` npm library so every namespace shares the
// `cc-remote:` root prefix. These logs are silent unless the `DEBUG` env var
// opts in — enable all of them in development with `DEBUG=cc-remote:*`, or a
// single area with e.g. `DEBUG=cc-remote:auth`.
import createDebug from "debug";

export function debug(namespace: string): createDebug.Debugger {
  return createDebug(`cc-remote:${namespace}`);
}
