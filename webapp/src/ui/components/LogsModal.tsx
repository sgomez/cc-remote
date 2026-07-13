// Logs modal — the diagnostic you reach for when something is wrong, not a panel
// that squats on the detail page forever. Opens on demand for ANY status,
// including `error`, `stopped` and `clone_failed`: a container that isn't running
// has no terminal to attach to, so its output is the only evidence there is.
//
// It follows the SSE log stream (/api/sessions/:name/logs) rather than taking a
// snapshot: open it while a session boots (or while a clone fails) and the lines
// arrive as they are produced. Closing the modal closes the EventSource, which
// aborts the request, which tears the Docker follow down server-side — that
// chain is why there is no Refresh button and no leaked stream.
//
// Native <dialog> + showModal(), same as the confirm dialog (feedback.tsx), so
// Escape and the backdrop behave the way the rest of the app does.

import { useEffect, useRef, useState } from "react";
import type { SessionLogsSource } from "~/core";
import { Spinner } from "./Spinner";

type StreamState = "connecting" | "streaming" | "ended" | "failed";

/** Distance from the bottom (px) still counted as "the user is following along". */
const STICK_THRESHOLD = 40;

export function LogsModal({ sessionName, onClose }: { sessionName: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  // The user is "pinned" to the bottom until they scroll up to read something.
  const pinnedRef = useRef(true);

  const [text, setText] = useState("");
  const [state, setState] = useState<StreamState>("connecting");
  const [source, setSource] = useState<SessionLogsSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Open as a modal (not an inline dialog) once mounted.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/sessions/${encodeURIComponent(sessionName)}/logs`);

    const onOpen = (ev: MessageEvent) => {
      try {
        setSource(JSON.parse(ev.data).source as SessionLogsSource);
      } catch {
        // A malformed open event costs us only the "which container" note.
      }
      setState("streaming");
    };
    const onChunk = (ev: MessageEvent) => {
      try {
        const { text: chunk } = JSON.parse(ev.data) as { text: string };
        setText((prev) => prev + chunk);
        setState("streaming");
      } catch {
        // Ignore an unparseable frame rather than killing the stream.
      }
    };
    const onEnd = () => setState("ended");
    const onErrorEvent = (ev: MessageEvent) => {
      try {
        setError((JSON.parse(ev.data) as { message: string }).message);
      } catch {
        setError("The log stream failed.");
      }
      setState("failed");
    };
    // Transport-level failure (server gone, proxy dropped it). EventSource would
    // silently retry forever; we say so instead of pretending to still be live.
    const onTransportError = () => {
      setState((prev) => (prev === "ended" ? prev : "failed"));
    };

    es.addEventListener("open", onOpen as EventListener);
    es.addEventListener("chunk", onChunk as EventListener);
    es.addEventListener("end", onEnd);
    es.addEventListener("error", onErrorEvent as EventListener);
    es.onerror = onTransportError;

    // Closing the EventSource aborts the HTTP request, which is what tears down
    // the Docker follow on the server. This cleanup is the teardown.
    return () => es.close();
  }, [sessionName]);

  // Auto-scroll ONLY while the user is at the bottom. Yanking someone back down
  // while they are reading is the single most infuriating thing a log viewer can
  // do, so scrolling up opts you out until you scroll back down.
  useEffect(() => {
    const el = outputRef.current;
    if (!el || text === "" || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  const onScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distance <= STICK_THRESHOLD;
  };

  const statusNote = () => {
    if (state === "failed") return <span className="error-text">{error ?? "Stream failed."}</span>;
    if (state === "ended")
      return <span>Stream ended — the container is no longer producing output.</span>;
    if (state === "connecting")
      return (
        <span>
          <Spinner /> Connecting…
        </span>
      );
    return (
      <span>
        <span className="live-dot" /> Live
        {source === "clone" ? " — clone helper output" : ""}
      </span>
    );
  };

  return (
    <dialog ref={dialogRef} className="logs-dialog" onClose={onClose}>
      <div className="logs-dialog-head">
        <div>
          <h2>Logs</h2>
          <p className="subtle tight">
            {source === "clone"
              ? `cc-remote-session-clone-${sessionName}`
              : `cc-remote-session-${sessionName}`}
          </p>
        </div>
        <button
          type="button"
          className="btn small"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close logs"
        >
          Close
        </button>
      </div>

      {text === "" ? (
        <p className={`logs-empty ${state === "failed" ? "error-text" : "subtle"}`}>
          {state === "failed"
            ? (error ?? "Couldn't read this container's logs.")
            : state === "connecting"
              ? "Opening the log stream…"
              : "This container hasn't logged anything yet. New output will appear here as it arrives."}
        </p>
      ) : (
        <pre ref={outputRef} className="logs-output" onScroll={onScroll}>
          {text}
        </pre>
      )}

      <div className="logs-dialog-foot subtle">{statusNote()}</div>
    </dialog>
  );
}
