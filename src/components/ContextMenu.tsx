import clsx from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

type ShowFn = (e: ReactMouseEvent, items: ContextMenuItem[]) => void;

const Ctx = createContext<ShowFn>(() => {});
export function useContextMenu() {
  return useContext(Ctx);
}

const WIDTH = 198;

// One themed right-click menu for the whole app. The native browser menu is
// suppressed everywhere except real text fields (so paste still works there).
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const show = useCallback<ShowFn>((e, items) => {
    e.preventDefault();
    e.stopPropagation();
    if (items.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  // Kill the default browser context menu app-wide, except inside text fields.
  useEffect(() => {
    const onCtx = (e: globalThis.MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, [contenteditable='true'], .allow-select"))
        return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const estH = menu ? menu.items.length * 33 + 8 : 0;
  const left = menu
    ? Math.max(8, Math.min(menu.x, window.innerWidth - WIDTH - 8))
    : 0;
  const top = menu
    ? Math.max(8, Math.min(menu.y, window.innerHeight - estH - 8))
    : 0;
  // Grow from whichever corner sits next to the cursor, even when clamped.
  const originX = menu && left < menu.x ? "right" : "left";
  const originY = menu && top < menu.y ? "bottom" : "top";

  return (
    <Ctx.Provider value={show}>
      {children}
      {menu && (
        <div
          className="fixed z-[60] surface rounded-lg shadow-xl py-1 context-pop"
          style={{
            left,
            top,
            width: WIDTH,
            transformOrigin: `${originY} ${originX}`,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.items.map((it, i) => (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => {
                setMenu(null);
                if (!it.disabled) it.onClick();
              }}
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] font-semibold transition",
                it.disabled
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:bg-[color:var(--brand-primary)]/10",
                it.danger ? "text-red-600" : "text-[color:var(--brand-fg)]"
              )}
            >
              {it.icon && (
                <span
                  className={clsx(
                    "shrink-0",
                    it.danger
                      ? "text-red-600"
                      : "text-[color:var(--brand-primary)]"
                  )}
                >
                  {it.icon}
                </span>
              )}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}
