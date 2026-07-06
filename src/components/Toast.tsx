import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import clsx from "clsx";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  dismissing?: boolean;
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 150);
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => prev.some((t) => t.message === message && !t.dismissing) ? prev : [...prev, { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === "error" ? 8000 : 4500);
  }, [dismiss]);

  const api: ToastApi = useMemo(() => ({
    push,
    success: (m: string) => push("success", m),
    error: (m: string) => push("error", m),
    info: (m: string) => push("info", m),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed top-[68px] left-3 right-3 flex flex-col gap-1.5 z-10 pointer-events-none">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const Icon = item.kind === "success" ? CheckCircle2 : item.kind === "info" ? Info : AlertTriangle;
  return (
    <div
      onClick={onClose}
      className={clsx(
        "pointer-events-auto cursor-pointer flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium",
        "shadow-[0_4px_20px_-4px_rgba(0,0,0,0.25)] backdrop-blur-md",
        "transition-all active:scale-95",
        item.dismissing
          ? "toast-dismiss"
          : "animate-[toast-in_300ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
        item.kind === "success" && "bg-emerald-600 text-white",
        item.kind === "error" && "bg-[color:var(--brand-primary)] text-white",
        item.kind === "info" && "bg-[color:var(--brand-bg-soft)] text-[color:var(--brand-fg)] border border-[color:var(--brand-border)]"
      )}
    >
      <Icon size={15} className="shrink-0 opacity-90" />
      <span className="flex-1 leading-snug">{item.message}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Schließen"
        className={clsx(
          "shrink-0 ml-1 -mr-1.5 p-1 rounded-md transition active:scale-90",
          item.kind === "info"
            ? "text-[color:var(--brand-fg)]/45 hover:text-[color:var(--brand-fg)]/80 hover:bg-[color:var(--brand-fg)]/10"
            : "text-white/70 hover:text-white hover:bg-white/15"
        )}
      >
        <X size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

