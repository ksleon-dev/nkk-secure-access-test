import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
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
      <div className="fixed bottom-3 left-3 right-3 flex flex-col gap-2 pointer-events-none z-50">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onClose={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const Icon = item.kind === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div
      className={clsx(
        "pointer-events-auto flex items-start gap-2 rounded-lg px-3 py-2 text-sm shadow-lg backdrop-blur",
        "border surface",
        item.kind === "success" && "border-green-500/40",
        item.kind === "error" && "border-red-500/50",
        item.kind === "info" && "border-blue-500/40"
      )}
    >
      <Icon
        size={16}
        className={clsx(
          "mt-0.5 shrink-0",
          item.kind === "success" && "text-green-500",
          item.kind === "error" && "text-red-500",
          item.kind === "info" && "text-blue-500"
        )}
      />
      <span className="flex-1 break-words leading-snug">{item.message}</span>
      <button
        onClick={onClose}
        className="opacity-60 hover:opacity-100 transition"
        aria-label="Schließen"
      >
        <X size={14} />
      </button>
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
