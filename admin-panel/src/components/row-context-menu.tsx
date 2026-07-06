import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

// Leichtgewichtiges Rechtsklick-Menue fuer Tabellenzeilen. Kein Radix noetig,
// per Portal an document.body (nicht vom Tabellen-overflow abgeschnitten),
// am Viewport-Rand geclampt, schliesst bei Klick/Scroll/Esc/Resize.
export type CtxMenuItem =
  | { kind: "sep" }
  | { kind: "header"; label: string; sublabel?: string }
  | {
      label: string
      icon?: ComponentType<{ className?: string }>
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
    }

type MenuState = { x: number; y: number; items: CtxMenuItem[] }
const WIDTH = 232

function isAction(
  it: CtxMenuItem
): it is Extract<CtxMenuItem, { onSelect: () => void }> {
  return "onSelect" in it
}

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const open = useCallback((e: ReactMouseEvent, items: CtxMenuItem[]) => {
    // Nur oeffnen, wenn es echte Aktionen gibt (nicht nur Header/Trenner).
    if (!items.some(isAction)) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }, [])

  const close = useCallback(() => setMenu(null), [])

  return {
    open,
    close,
    node: menu ? <ContextMenuView menu={menu} onClose={close} /> : null,
  }
}

function ContextMenuView({
  menu,
  onClose,
}: {
  menu: MenuState
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })

  useEffect(() => {
    const onClick = () => onClose()
    const onScroll = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("click", onClick)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onClose)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("click", onClick)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onClose)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  // Am Rand clampen, damit das Menue nie aus dem Viewport laeuft.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight
    let x = menu.x
    let y = menu.y
    if (x + WIDTH > window.innerWidth - 8) x = window.innerWidth - WIDTH - 8
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8)
    setPos({ x: Math.max(8, x), y: Math.max(8, y) })
  }, [menu])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", top: pos.y, left: pos.x, width: WIDTH }}
      className="z-50 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) => {
        if ("kind" in it && it.kind === "sep")
          return <div key={i} className="my-1 h-px bg-border" />
        if ("kind" in it && it.kind === "header")
          return (
            <div
              key={i}
              className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              <span className="truncate">{it.label}</span>
              {it.sublabel && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums">
                  {it.sublabel}
                </span>
              )}
            </div>
          )
        const a = it as Extract<CtxMenuItem, { onSelect: () => void }>
        const Icon = a.icon
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={a.disabled}
            onClick={() => {
              if (a.disabled) return
              a.onSelect()
              onClose()
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors",
              a.disabled
                ? "pointer-events-none opacity-50"
                : "hover:bg-accent hover:text-accent-foreground",
              a.danger &&
                !a.disabled &&
                "text-destructive hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            <span className="truncate">{a.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
