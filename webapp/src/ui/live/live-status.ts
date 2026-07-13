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

import { useEffect, useRef, useState } from "react";
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

/** Comparison key for a snapshot. Both sides go through the same serializer, so
 * key order is stable and string equality means "no visible change". */
export function snapshotKey(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Decide what to do with an incoming raw SSE payload. Returns the parsed
 * snapshot plus its comparison key, or `null` to skip — either because it
 * carries no change from the last applied snapshot or because it failed to
 * parse. Skipping matters for more than efficiency: committing a no-op inside
 * `startViewTransition` starts a *second* transition, and a new transition
 * cancels whichever one is still running — including the router's navigation
 * transition. Pure so it's unit-testable without a DOM.
 */
export function parseNextSnapshot<T>(
  data: string,
  lastKey: string | undefined,
): { value: T; key: string } | null {
  let value: T;
  try {
    value = JSON.parse(data) as T;
  } catch {
    return null;
  }
  const key = snapshotKey(value);
  return key === lastKey ? null : { value, key };
}

/**
 * Subscribe to a named SSE event on `path`, returning the latest JSON snapshot
 * (seeded with `initial` until a *differing* message arrives). Each real change
 * is applied inside a View Transition so dependent badges morph.
 *
 * The stream's opening message is applied WITHOUT a transition. It is a replay of
 * the state the route loader already rendered, so there is nothing to animate —
 * and animating it is actively harmful: starting a view transition cancels any
 * transition still running, which milliseconds after a navigation means the
 * router's own transition. That is what made list→detail morphs vanish.
 *
 * Deduping on the key alone is not enough, because a page may seed from a
 * narrower slice than the stream sends (the account detail page seeds one
 * account; the stream sends every account). Such a seed can never match, so the
 * first message must be excluded by position, not just by value.
 */
export function useLiveSnapshot<T>(path: string, event: string, initial: T): T {
  const [snapshot, setSnapshot] = useState<T>(initial);
  const lastKey = useRef<string>(snapshotKey(initial));
  const opened = useRef(false);

  useEffect(() => {
    const source = new EventSource(path);
    const onMessage = (ev: MessageEvent) => {
      const next = parseNextSnapshot<T>(ev.data, lastKey.current);
      const isOpening = !opened.current;
      opened.current = true;
      if (!next) return;
      lastKey.current = next.key;
      if (isOpening) {
        setSnapshot(next.value);
        return;
      }
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
