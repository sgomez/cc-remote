// Pure helpers for the Server-Sent Events status streams (#15). The TSS route
// handlers (`src/routes/api/**`) own the ReadableStream, polling, and auth; this
// module owns the wire format and change detection so both are unit-tested and
// the handlers stay thin.

/** Serialize a named SSE event with a JSON `data` payload. */
export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * An SSE comment line — a keep-alive the browser's EventSource ignores. Emitted
 * on a timer so the stream demonstrably flushes progressively (no buffering)
 * even when the underlying status has not changed.
 */
export function formatSseComment(text: string): string {
  return `: ${text}\n\n`;
}

/**
 * Emits-on-change gate for a polled snapshot: `changed` returns true the first
 * time it is called and thereafter only when the JSON-serialized value differs
 * from the last one it accepted. Callers pass snapshots in a stable order so
 * equal states serialize equally.
 */
export class ChangeTracker {
  private last: string | undefined;

  changed(value: unknown): boolean {
    const next = JSON.stringify(value);
    if (next === this.last) return false;
    this.last = next;
    return true;
  }
}
