// Pure toast-queue reducer (the client-side action feedback for #16 follow-up).
// Kept framework-free and colocated-tested: ids are injected by the caller so
// the reducer stays pure — the React glue (FeedbackProvider) owns id generation
// and the auto-dismiss timer.

export type ToastKind = "error" | "success";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

/** Append a toast with the caller-supplied id; never mutates the input. */
export function addToast(state: Toast[], toast: Omit<Toast, "id">, id: string): Toast[] {
  return [...state, { id, ...toast }];
}

/** Drop the toast with `id`; a no-op (new array) when it isn't present. */
export function dismissToast(state: Toast[], id: string): Toast[] {
  return state.filter((t) => t.id !== id);
}
