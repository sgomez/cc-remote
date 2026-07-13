// Session logs — the "why didn't it come up?" surface. Logs matter most exactly
// when the container is NOT running: a crashed agent (`error`) or a failed clone
// (`clone_failed`) has no web terminal to attach to, so its container output is
// the only evidence the user has.
//
// `source` records WHICH container the text came from: a `clone_failed` session's
// only container is the clone helper, and saying so is what keeps the panel
// honest ("this is the git clone output", not "this is your agent").

/** Which of a session's two possible containers produced the text. */
export type SessionLogsSource = "session" | "clone";

export type SessionLogs = {
  text: string;
  source: SessionLogsSource;
};

/** Lines of tail to read. Enough to cover a startup failure, bounded so a chatty
 *  agent container can't stream megabytes into the browser. */
export const DEFAULT_LOG_TAIL = 300;

// Our containers run with a TTY (ttyd, tmux, git), so their output is peppered
// with ANSI escape sequences — colour, cursor moves, window-title sets. A <pre>
// renders those as literal noise ("[0m[35;1m[2026/07/13…"), which is exactly
// the junk a user trying to read a crash trace does not need. We render text,
// not a terminal, so we strip the escapes rather than pretend to interpret them.
const ANSI_ESCAPES = new RegExp(
  [
    "\\u001b\\[[0-9;?]*[ -/]*[@-~]", // CSI (colour, cursor, erase…)
    "\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)", // OSC (window title), BEL- or ST-terminated
    "\\u001b[@-Z\\\\-_]", // lone two-character escapes
  ].join("|"),
  "g",
);

/**
 * Make raw container output readable as text: drop ANSI escape sequences and
 * normalise CRLF (a TTY emits `\r\n`, which would otherwise show as a stray
 * carriage return in the browser). Content is never otherwise altered — no
 * truncation, no reordering: the panel must show what the container actually
 * said.
 */
export function sanitizeLogText(raw: string): string {
  return raw.replace(ANSI_ESCAPES, "").replace(/\r\n/g, "\n");
}
