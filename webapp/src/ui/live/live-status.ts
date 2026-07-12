// Live status via SSE (#16), the client half of the #15 status streams. A route
// loader seeds the initial snapshot; this hook then subscribes to the
// `/api/{sessions,accounts}/status` EventSource and replaces it whenever the
// server pushes a change — a `cloning`→`running` or `pending_login`→`ready`
// flip. The replacement runs inside `document.startViewTransition` (via
// `commitWithTransition`) so the status badges morph instead of snapping;
// Firefox (no View Transitions) degrades to an instant swap. EventSource only
// exists in the browser, so the subscription lives entirely in an effect and
// SSR renders the seeded snapshot.

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished?: Promise<void> };
};

/** Run a state mutation inside a View Transition when the browser supports it. */
export function commitWithTransition(mutate: () => void): void {
  const doc = typeof document !== "undefined" ? (document as DocumentWithVT) : undefined;
  if (doc?.startViewTransition) {
    const transition = doc.startViewTransition(() => flushSync(mutate));
    // Overlapping transitions (a navigation racing a status flip) reject the
    // older one's `finished` promise — harmless, silence it.
    transition.finished?.catch(() => {});
  } else {
    mutate();
  }
}

/**
 * Subscribe to a named SSE event on `path`, returning the latest JSON snapshot
 * (seeded with `initial` until the first message). Each update is applied inside
 * a View Transition so dependent badges morph.
 */
export function useLiveSnapshot<T>(path: string, event: string, initial: T): T {
  const [snapshot, setSnapshot] = useState<T>(initial);

  useEffect(() => {
    const source = new EventSource(path);
    const onMessage = (ev: MessageEvent) => {
      let next: T;
      try {
        next = JSON.parse(ev.data) as T;
      } catch {
        return;
      }
      commitWithTransition(() => setSnapshot(next));
    };
    source.addEventListener(event, onMessage);
    return () => {
      source.removeEventListener(event, onMessage);
      source.close();
    };
  }, [path, event]);

  return snapshot;
}
