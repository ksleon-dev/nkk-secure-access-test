import { useData } from "@/lib/data-context"
import { fmtNum } from "@/lib/format"
import { PageHeader, ErrorState } from "@/components/common/bits"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { HardDrive, ShieldCheck, DownloadCloud, Archive, KeyRound } from "lucide-react"
import type { ReactNode } from "react"

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right font-medium tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function SystemPage() {
  const { data, loading, error, refresh } = useData()
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />
  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Server / System" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    )
  }
  if (!data) return null

  const s = data.status
  const uc = s.update_channel
  const bk = s.backup

  return (
    <div>
      <PageHeader title="Server / System" description="Zustand von serv-secure — Speicher, Backups, Zertifikat, Auslieferung." />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card icon={<HardDrive className="size-4" />} title="Speicher">
          {(s.disks ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Angaben.</p>
          ) : (
            (s.disks ?? []).map((d) => {
              const tone = d.used_pct >= 90 ? "bad" : d.used_pct >= 80 ? "warn" : "ok"
              const barColor = d.used_pct >= 90 ? "bg-destructive" : d.used_pct >= 80 ? "bg-warn" : "bg-ok"
              return (
                <div key={d.mount} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono">{d.mount}</span>
                    <span className={cn("font-medium tabular-nums", tone === "bad" && "text-destructive", tone === "warn" && "text-warn")}>
                      {d.used_pct}% · {fmtNum(d.free_gb, 0)} GB frei
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                    <div className={cn("h-full rounded-full", barColor)} style={{ width: `${Math.min(100, d.used_pct)}%` }} />
                  </div>
                </div>
              )
            })
          )}
        </Card>

        <Card icon={<Archive className="size-4" />} title="Backup">
          {bk?.newest ? (
            <>
              <Row label="Neuestes" value={<span className="font-mono text-[12.5px]">{bk.newest}</span>} />
              <Row label="Alter" value={`vor ${fmtNum(bk.age_hours, 1)} h`} tone={bk.age_hours != null && bk.age_hours > 26 ? "warn" : "ok"} />
              <Row label="Dateien" value={bk.count ?? "—"} />
            </>
          ) : (
            <p className="text-sm text-destructive">Kein Backup gefunden.</p>
          )}
        </Card>

        <Card icon={<ShieldCheck className="size-4" />} title="Zertifikat & Update-Kanal">
          {s.cert?.days_left != null ? (
            <Row
              label="Zertifikat läuft ab"
              value={`in ${s.cert.days_left} Tagen (${s.cert.not_after})`}
              tone={s.cert.days_left <= 5 ? "bad" : s.cert.days_left <= 14 ? "warn" : "ok"}
            />
          ) : (
            <Row label="Zertifikat" value="—" />
          )}
          <Row
            label="Auto-Update-Kanal"
            value={uc?.ok ? `aktiv (v${uc.version})` : "inaktiv"}
            tone={uc?.ok ? "ok" : "bad"}
          />
          {!uc?.ok && uc?.error && <p className="mt-1 text-xs text-muted-foreground">{uc.error}</p>}
        </Card>

        <Card icon={<DownloadCloud className="size-4" />} title="Auslieferung">
          <Row label="Installer (.exe)" value={s.exe ? `${fmtNum(s.exe.size_mb, 0)} MB · ${s.exe.mtime}` : "—"} />
          <Row label="Paket (.zip)" value={s.zip ? `${fmtNum(s.zip.size_mb, 0)} MB · ${s.zip.mtime}` : "—"} />
          <div className="mt-3 flex items-center gap-2 border-t pt-3 text-sm text-muted-foreground">
            <KeyRound className="size-3.5" />
            NetBird-Token serverseitig (nie im Browser)
          </div>
        </Card>
      </div>
    </div>
  )
}
