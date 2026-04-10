import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import clsx from "clsx";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
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

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const api: ToastApi = {
    push,
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed top-2 left-3 right-3 flex flex-col gap-1.5 pointer-events-none z-50">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item }: { item: ToastItem; onClose: () => void }) {
  const Icon = item.kind === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={clsx(
        "pointer-events-none flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium",
        "shadow-[0_4px_20px_-4px_rgba(0,0,0,0.25)] backdrop-blur-md",
        "animate-[toast-in_300ms_cubic-bezier(0.2,0.8,0.2,1)_both]",
        item.kind === "success" && "bg-emerald-600 text-white",
        item.kind === "error" && "bg-red-600 text-white",
        item.kind === "info" && "bg-[color:var(--brand-fg)] text-[color:var(--brand-bg)]"
      )}
    >
      <Icon size={15} className="shrink-0 opacity-90" />
      <span className="leading-snug">{item.message}</span>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

// Re-export effect hook to listen for window unmount edge cases
export function useToastSafeUnmount() {
  useEffect(() => () => {}, []);
}
