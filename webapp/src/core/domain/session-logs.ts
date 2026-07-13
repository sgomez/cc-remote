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
    // Lone two-character escapes: ESC + 0x40..0x5F, but NOT `[` or `]` — those
    // introduce CSI/OSC and are matched (or, mid-stream, held) by the
    // alternatives above. Spelling the class out avoids `\\-_` being read as a
    // RANGE (backslash..underscore), which silently swallowed `]`.
    "\\u001b[@A-Z\\\\^_]",
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

/** A complete escape sequence anchored at the start of the string. */
const ANCHORED_ESCAPE = new RegExp(`^(?:${ANSI_ESCAPES.source})`);

/**
 * How much unterminated escape we are willing to hold back. A real sequence is
 * a handful of bytes; anything longer is a lone ESC in the container's output
 * that will never be completed, and holding it forever would silently swallow
 * the log lines behind it.
 */
const MAX_HELD = 64;

/**
 * Split `text` into what is safe to emit now and what must wait for more bytes.
 * A follow stream cuts the output at arbitrary byte offsets, so a chunk can end
 * mid-escape (`[3` … `2m`) or between the halves of a CRLF — emitting
 * either half immediately is what would leak `[32m` junk into the panel.
 */
function splitTrailingPartial(text: string): { ready: string; held: string } {
  let cut = text.length;

  const lastEsc = text.lastIndexOf("\u001b");
  if (lastEsc !== -1 && !ANCHORED_ESCAPE.test(text.slice(lastEsc))) {
    // An ESC that hasn't terminated yet — unless it's so long it never will.
    if (text.length - lastEsc <= MAX_HELD) cut = lastEsc;
  }
  // A trailing CR may be the first half of a CRLF still in flight.
  if (cut === text.length && text.endsWith("\r")) cut = text.length - 1;

  return { ready: text.slice(0, cut), held: text.slice(cut) };
}

export type LogSanitizer = {
  /** Sanitize a chunk, holding back any trailing partial sequence. */
  push(chunk: string): string;
  /** Emit whatever was held back (the stream ended; it will never complete). */
  flush(): string;
};

/**
 * The streaming counterpart of `sanitizeLogText`. Same output for the same total
 * input, no matter where the chunk boundaries fall — which a one-shot read never
 * had to care about, but a live follow does.
 */
export function createLogSanitizer(): LogSanitizer {
  let held = "";

  return {
    push(chunk: string): string {
      const split = splitTrailingPartial(held + chunk);
      held = split.held;
      return sanitizeLogText(split.ready);
    },
    flush(): string {
      const rest = held;
      held = "";
      return sanitizeLogText(rest);
    },
  };
}
