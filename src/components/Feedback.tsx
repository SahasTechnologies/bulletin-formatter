/**
 * In-app feedback: toasts and confirmation dialogs.
 *
 * The app used `window.alert` / `window.confirm` in eleven places. Those are
 * native, *blocking* dialogs: they freeze the whole tab (so the document
 * underneath is not re-rendered, timers stall), they cannot be styled to match
 * the rest of the app, they render the page URL and origin, and some browsers
 * suppress them outright after the user ticks "prevent this page from creating
 * additional dialogs" - after which the user is told nothing at all.
 *
 * This module replaces them with two pieces of ordinary UI:
 *
 *  - `toast(message)` - a non-blocking notice in the bottom-left corner that
 *    fades out on its own (errors linger twice as long as successes);
 *  - `confirm({...})` - a real modal that returns a promise, so a destructive
 *    action reads exactly like the native call it replaced:
 *    `if (await confirm({...})) { ... }`.
 *
 * Wrap the app once in `<FeedbackProvider>` and call `useFeedback()` anywhere
 * below it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** A second, quieter line - the "why", or what to do about it. */
  detail?: string;
  /** Override the auto-dismiss delay in ms. `0` keeps it until dismissed. */
  timeout?: number;
}

export interface ConfirmOptions {
  title: string;
  /** Plain-language consequences of saying yes. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive and focus Cancel instead. */
  danger?: boolean;
}

export interface FeedbackApi {
  toast: (message: string, options?: ToastOptions) => void;
  dismiss: (id: number) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface Toast extends ToastOptions {
  id: number;
  message: string;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

/** How long a toast stays before it fades itself out. */
const TOAST_MS: Record<ToastKind, number> = { info: 6000, success: 5000, error: 11000 };

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prompt, setPrompt] = useState<ConfirmOptions | null>(null);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  /** The resolver of the open confirmation, if any. */
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const kind = options?.kind ?? 'info';
      seq.current += 1;
      const id = seq.current;
      // Keep the stack short: the newest three notices are the useful ones.
      setToasts((list) => [...list.slice(-2), { ...options, kind, id, message }]);
      const ms = options?.timeout ?? TOAST_MS[kind];
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  const confirm = useCallback((options: ConfirmOptions) => {
    // A second request while one is open cancels the first rather than
    // silently swallowing its promise, which would hang the caller forever.
    answer.current?.(false);
    answer.current = null;
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setPrompt(options);
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setPrompt(null);
    resolve?.(ok);
  }, []);

  useEffect(() => {
    if (!prompt) return;
    // Destructive prompts start on Cancel, so a stray Enter cannot delete.
    (prompt.danger ? cancelBtn : confirmBtn).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        settle(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prompt, settle]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<FeedbackApi>(
    () => ({ toast, dismiss, confirm }),
    [toast, dismiss, confirm],
  );

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      {/* Notices, bottom-left, newest last. */}
      <div className="no-print pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[min(23rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-white px-3.5 py-2.5 shadow-xl ${
              t.kind === 'error' ? 'border-red-200' : 'border-gdoc-border'
            }`}
          >
            <span
              className={`mt-px flex-none ${
                t.kind === 'error'
                  ? 'text-red-600'
                  : t.kind === 'success'
                    ? 'text-emerald-600'
                    : 'text-bb-600'
              }`}
            >
              {t.kind === 'error' ? (
                <AlertTriangle size={15} />
              ) : t.kind === 'success' ? (
                <CheckCircle2 size={15} />
              ) : (
                <Info size={15} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-[#2b2622]">{t.message}</p>
              {t.detail && (
                <p className="mt-0.5 text-[11.5px] leading-snug text-gdoc-muted">{t.detail}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="flex-none rounded p-0.5 text-gdoc-muted hover:bg-gdoc-hover hover:text-[#2b2622]"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* Confirmation, in the app's own dialog style. */}
      {prompt && (
        <div
          className="no-print fixed inset-0 z-[70] grid place-items-center bg-black/30 p-4"
          onClick={() => settle(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={prompt.title}
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-[15px] font-semibold text-[#2b2622]">{prompt.title}</h2>
            {prompt.body && (
              <p className="mb-3 text-[12.5px] leading-snug text-gdoc-muted">{prompt.body}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={cancelBtn}
                onClick={() => settle(false)}
                className="rounded border border-gdoc-border px-3 py-1.5 text-[13px] text-[#2b2622] hover:bg-gdoc-hover"
              >
                {prompt.cancelLabel ?? 'Cancel'}
              </button>
              <button
                ref={confirmBtn}
                onClick={() => settle(true)}
                className={`rounded px-3 py-1.5 text-[13px] font-medium text-white ${
                  prompt.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-bb-500 hover:bg-bb-600'
                }`}
              >
                {prompt.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

/**
 * Toasts and confirmations. Throws rather than returning a no-op API, so a
 * component rendered outside the provider fails loudly in development instead
 * of silently dropping the user's notices.
 */
export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return api;
}
