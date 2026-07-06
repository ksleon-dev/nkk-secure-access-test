import type { ReactNode } from "react"
import { toast } from "sonner"
import { Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { versionKind } from "@/lib/format"
import { downloadMd } from "@/lib/md-export"

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

// Wiederverwendbarer Export-Button: onExport baut den Markdown-String (Ansicht
// entscheidet ueber Inhalt), downloadMd stoesst den Download an. Ueberall gleich.
export function ExportMdButton({
  onExport,
  filename,
  label = "Export .md",
  disabled,
}: {
  onExport: () => string
  filename: string
  label?: string
  disabled?: boolean
}) {
  function go() {
    downloadMd(filename, onExport())
    toast.success("Als Markdown exportiert.")
  }
  return (
    <Button variant="outline" size="sm" onClick={go} disabled={disabled}>
      <Download className="size-3.5" /> {label}
    </Button>
  )
}

export function ConnBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
      <span className="size-1.5 rounded-full bg-ok" />
      online
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
      offline
    </span>
  )
}

export function VersionBadge({ version, current }: { version: string | null | undefined; current: string }) {
  const kind = versionKind(version, current)
  const label = version && version !== "None" ? version : "unbekannt"
  const cls =
    kind === "current"
      ? "bg-ok/10 text-ok"
      : kind === "older"
        ? "bg-destructive/10 text-destructive"
        : kind === "old"
          ? "bg-warn/10 text-warn"
          : "bg-muted text-muted-foreground"
  return <span className={cn("rounded-full px-2 py-0.5 font-mono text-[11.5px] font-medium tabular-nums", cls)}>{label}</span>
}

// Update rollout at a glance: how many devices are already on the target
// version, how many are behind, how many never reported. Honest about freshness
// (the version is whatever a device last reported, not live).
export function RolloutCard({
  devices,
  current,
}: {
  devices: { app_version: string | null | undefined }[]
  current: string
}) {
  const norm = (v?: string | null) => (v && v !== "None" ? v : null)
  const total = devices.length
  const onLatest = devices.filter((d) => norm(d.app_version) === current).length
  const unknown = devices.filter((d) => !norm(d.app_version)).length
  const outdated = total - onLatest - unknown
  const pct = total ? Math.round((onLatest / total) * 100) : 0
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-muted-foreground">Update-Rollout · Ziel v{current}</div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {onLatest} <span className="text-muted-foreground">/ {total}</span>
            <span className="ml-2 text-base font-medium text-muted-foreground">auf v{current}</span>
          </div>
        </div>
        <div className="shrink-0 text-2xl font-semibold tabular-nums text-ok">{pct}%</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-ok" />{onLatest} aktuell</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-warn" />{outdated} veraltet</span>
        {unknown > 0 && (
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/40" />{unknown} ohne Meldung</span>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Stand der letzten Geräte-Meldung. Clients aktualisieren sich beim nächsten Start automatisch; die neue Version erscheint hier mit der nächsten Meldung.
      </p>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      Fehler: {message}
      {onRetry && (
        <button onClick={onRetry} className="ml-2 underline underline-offset-2">
          erneut versuchen
        </button>
      )}
    </div>
  )
}

export function SevBadge({ severity }: { severity: "high" | "warn" | "info" }) {
  const map = {
    high: { cls: "bg-destructive/10 text-destructive", label: "wichtig" },
    warn: { cls: "bg-warn/10 text-warn", label: "Hinweis" },
    info: { cls: "bg-muted text-muted-foreground", label: "Info" },
  } as const
  const m = map[severity]
  return <Badge variant="secondary" className={cn("border-0", m.cls)}>{m.label}</Badge>
}
