// Live status via SSE (#16), the client half of the #15 status streams. A route
// loader seeds the initial snapshot; this hook then subscribes to the
// `/api/{sessions,accounts}/status` EventSource and replaces it whenever the
// server pushes a change — a `cloning`→`running` or `pending_login`→`ready`
// flip. The replacement runs inside `document.startViewTransition` (via
// `commitWithTransition`) so the status badges morph instead of snapping. The
// View Transitions API is Baseline across engines (Chrome/Safari/Firefox 144+);
// on the rare engine without it, `commitWithTransition` degrades to an instant
// swap, and it also skips the transition when the user prefers reduced motion.
// EventSource only exists in the browser, so the subscription lives entirely in
// an effect and SSR renders the seeded snapshot.

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished?: Promise<void> };
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Run a state mutation inside a View Transition when the browser supports it and
 * the user hasn't asked for reduced motion; otherwise mutate synchronously.
 */
export function commitWithTransition(mutate: () => void): void {
  const doc = typeof document !== "undefined" ? (document as DocumentWithVT) : undefined;
  if (doc?.startViewTransition && !prefersReducedMotion()) {
    const transition = doc.startViewTransition(() => flushSync(mutate));
    // Overlapping transitions (a navigation racing a status flip) reject the
    // older one's `finished` promise — harmless, silence it.
    transition.finished?.catch(() => {});
  } else {
    mutate();
  }
}

/**
 * Decide what to do with an incoming raw SSE payload. Returns the parsed
 * snapshot to apply, or `null` to skip — either because the payload is byte-for-
 * byte identical to the last applied one (re-committing it would start a no-op
 * view transition) or because it failed to parse. Pure so it's unit-testable
 * without a DOM.
 */
export function parseNextSnapshot<T>(
  data: string,
  lastData: string | undefined,
): { value: T } | null {
  if (data === lastData) return null;
  try {
    return { value: JSON.parse(data) as T };
  } catch {
    return null;
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
    // Track the last raw payload so redundant re-sends don't re-commit.
    let lastData: string | undefined;
    const onMessage = (ev: MessageEvent) => {
      const next = parseNextSnapshot<T>(ev.data, lastData);
      if (!next) return;
      lastData = ev.data;
      commitWithTransition(() => setSnapshot(next.value));
    };
    source.addEventListener(event, onMessage);
    return () => {
      source.removeEventListener(event, onMessage);
      source.close();
    };
  }, [path, event]);

  return snapshot;
}
