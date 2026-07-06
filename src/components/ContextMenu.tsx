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
  kind?: "item" | "separator" | "header";
  sublabel?: string;
}

type ShowFn = (e: ReactMouseEvent, items: ContextMenuItem[]) => void;

const Ctx = createContext<ShowFn>(() => {});
export function useContextMenu() {
  return useContext(Ctx);
}

const WIDTH = 212;

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
    // Never open a menu that has no clickable item (only headers/separators).
    // kind undefined defaults to an item, so pure item-menus behave as before.
    if (items.every((it) => it.kind && it.kind !== "item")) return;
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
    // Scroll uses capture so inner scroll containers (Admin-Grid) also close the
    // menu; without it the menu stays pinned at the stale position.
    window.addEventListener("scroll", close, true);
    window.addEventListener("wheel", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const estH = menu
    ? menu.items.reduce(
        (h, it) =>
          h +
          (it.kind === "separator" ? 9 : it.kind === "header" ? 26 : 33),
        8
      )
    : 0;
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
          {menu.items.map((it, i) => {
            if (it.kind === "separator") {
              return (
                <div
                  key={i}
                  className="my-1 h-px bg-[color:var(--brand-primary)]/15"
                />
              );
            }
            if (it.kind === "header") {
              return (
                <div
                  key={i}
                  className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted flex items-center justify-between"
                >
                  <span className="shrink-0">{it.label}</span>
                  {it.sublabel && (
                    <span className="min-w-0 truncate tabular-nums pl-2" title={it.sublabel}>{it.sublabel}</span>
                  )}
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                aria-disabled={it.disabled || undefined}
                // Kein natives disabled: ein disabled-Button feuert kein click,
                // dann bleibt das Menue offen. Stattdessen immer schliessen und
                // die Aktion nur bei aktivem Item ausfuehren.
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
            );
          })}
        </div>
      )}
    </Ctx.Provider>
  );
}
