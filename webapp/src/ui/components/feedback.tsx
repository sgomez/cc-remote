// App-wide action feedback (#16 follow-up): a promise-based confirm dialog and a
// toast stack, mounted once in the /_app shell. Replaces the native
// `window.confirm` (unstyled, blocking) and surfaces success/error from the
// otherwise-silent lifecycle server functions. The reducer/queue logic lives in
// the pure, unit-tested `~/ui/live/toasts`; this file is the thin React glue
// (native <dialog>.showModal + auto-dismiss timers) that isn't unit-tested.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { addToast, dismissToast, type Toast, type ToastKind } from "~/ui/live/toasts";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button as destructive (reset/destroy/delete). */
  danger?: boolean;
};

type FeedbackApi = {
  /** Resolves true if the user confirms, false on cancel/Escape. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  toast: { error: (message: string) => void; success: (message: string) => void };
};

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      dialogRef.current?.showModal();
    });
  }, []);

  // Cancel/Escape close the dialog, which fires onClose → resolve(false). The
  // confirm button resolves(true) first and clears the resolver so the ensuing
  // close can't double-settle the same promise.
  const settleClose = useCallback(() => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(false);
  }, []);

  const onConfirm = useCallback(() => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    dialogRef.current?.close();
    resolve?.(true);
  }, []);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = `toast-${nextId.current++}`;
    setToasts((state) => addToast(state, { kind, message }, id));
    setTimeout(() => setToasts((state) => dismissToast(state, id)), kind === "error" ? 6000 : 4000);
  }, []);

  const api = useMemo<FeedbackApi>(
    () => ({
      confirm,
      toast: {
        error: (message) => push("error", message),
        success: (message) => push("success", message),
      },
    }),
    [confirm, push],
  );

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      <dialog ref={dialogRef} className="confirm-dialog" onClose={settleClose}>
        {opts && (
          <div className="confirm-body">
            <h2>{opts.title}</h2>
            {opts.body && <p className="subtle">{opts.body}</p>}
            <div className="actions">
              <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
                {opts.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={`btn ${opts.danger ? "danger" : "primary"}`}
                onClick={onConfirm}
              >
                {opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        )}
      </dialog>

      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <output key={t.id} className={`toast ${t.kind}`}>
            <span>{t.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => setToasts((state) => dismissToast(state, t.id))}
            >
              ×
            </button>
          </output>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used within a FeedbackProvider");
  return ctx;
}
