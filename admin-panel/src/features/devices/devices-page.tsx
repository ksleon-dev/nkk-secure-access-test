import { useMemo, useState, useRef, useEffect } from "react"
import { useSearchParams } from "react-router"
import { toast } from "sonner"
import { useData } from "@/lib/data-context"
import { api, AuthError } from "@/lib/api"
import { fmtNum, relativeTime, daysSince } from "@/lib/format"
import { PageHeader, VersionBadge, EmptyState, ErrorState, RolloutCard, ExportMdButton } from "@/components/common/bits"
import { mdTable } from "@/lib/md-export"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Search, Laptop, ExternalLink, ArrowUpDown, ChevronUp, ChevronDown, Activity, MoreHorizontal, RefreshCw } from "lucide-react"
import type { Device, RunStatus } from "@/lib/types"

type SortKey = "hostname" | "app_version" | "netbird" | "last_seen" | "ping_internet" | "speed_mbps" | "local_ip" | "isp"

const STATUS_DE: Record<string, string> = {
  queued: "in Warteschlange",
  scheduled: "geplant",
  running: "läuft",
  when_next_online: "wartet bis online",
}

function freshness(s: string | null | undefined) {
  const ds = daysSince(s)
  if (ds == null) return "bg-muted-foreground/30"
  if (ds <= 7) return "bg-ok"
  if (ds <= 30) return "bg-warn"
  return "bg-muted-foreground/40"
}

function sortValue(d: Device, key: SortKey): string | number | null {
  switch (key) {
    case "last_seen":
      return d.last_seen ? Date.parse(d.last_seen) : null
    case "ping_internet":
      return d.ping_internet ?? null
    case "speed_mbps":
      return d.speed_mbps ?? null
    case "app_version":
      return d.app_version && d.app_version !== "None" ? d.app_version : null
    case "netbird":
      return d.netbird?.version ?? null
    case "isp":
      return d.isp?.isp ?? null
    case "local_ip":
      return d.local_ip ?? null
    default:
      return d.hostname ?? null
  }
}

export function DevicesPage() {
  const { data, loading, error, refresh } = useData()
  // Startwert + Sync aus ?q, damit die globale Suche direkt auf ein Geraet filtern kann.
  const [searchParams] = useSearchParams()
  const [q, setQ] = useState(searchParams.get("q") ?? "")
  useEffect(() => {
    const qp = searchParams.get("q")
    if (qp) setQ(qp)
  }, [searchParams])
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "last_seen", dir: "desc" })

  const automations = data?.level_automations ?? []
  const netbirdCurrent = data?.netbird_current ?? ""
  const mountedRef = useRef(true)
  const runningRef = useRef<Set<string>>(new Set()) // in-flight keys (re-entrancy guard)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "last_seen" || key === "ping_internet" || key === "speed_mbps" ? "desc" : "asc" },
    )
  }

  async function doPing(d: Device) {
    if (!d.local_ip) return
    const key = "ping:" + d.hostname
    if (runningRef.current.has(key)) return
    runningRef.current.add(key)
    const id = toast.loading(`Ping ${d.hostname} …`)
    try {
      const r = await api.pingDevice(d.local_ip)
      if (r.reachable) toast.success(`${d.hostname}: ${r.ms != null ? Math.round(r.ms) + " ms" : "erreichbar"}`, { id })
      else toast.error(`${d.hostname}: nicht erreichbar`, { id })
    } catch (e) {
      // req() wirft bei {ok:false} mit der konkreten Backend-Meldung
      toast.error(e instanceof Error ? e.message : "Ping fehlgeschlagen", { id })
    } finally {
      runningRef.current.delete(key)
    }
  }

  async function pollRun(runId: string, id: string | number, name: string) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 4000))
      if (!mountedRef.current) return // Seite verlassen -> nicht weiterpollen
      let s: RunStatus
      try {
        s = await api.runStatus(runId)
      } catch (e) {
        if (e instanceof AuthError) return // Session weg -> aufhoeren
        continue
      }
      if (!mountedRef.current) return
      const st = (s.status || "").toLowerCase()
      if (st === "success") return void toast.success(`${name}: erfolgreich`, { id })
      if (st === "warning") return void toast.warning(`${name}: fertig (mit Warnung)`, { id })
      if (st === "error" || st === "canceled" || st === "cancelled")
        return void toast.error(`${name}: fehlgeschlagen (${st})`, { id })
      toast.loading(`${name}: ${STATUS_DE[st] ?? st ?? "läuft"} …`, { id })
    }
    if (mountedRef.current) toast.info(`${name}: läuft im Hintergrund, Status in Level`, { id })
  }

  async function doAutomation(d: Device, name: string) {
    const gid = d.level?.gid
    if (!gid) return void toast.error("Kein Level-Gerät")
    const key = "run:" + d.hostname + ":" + name
    if (runningRef.current.has(key)) return void toast.info(`„${name}" läuft schon auf ${d.hostname}`)
    const offline = d.level?.online === false
    if (!window.confirm(`„${name}" auf ${d.hostname} auslösen?` + (offline ? "\nGerät ist offline, der Lauf startet, sobald es online ist." : ""))) return
    runningRef.current.add(key)
    const id = toast.loading(`${name} wird ausgelöst …`)
    try {
      const r = await api.runAutomation(gid, name)
      if (!r.run_id) {
        toast.info(r.note || "Ausgelöst (kein Lauf gestartet)", { id })
        return
      }
      toast.loading(offline ? `${name}: wartet bis Gerät online …` : `${name}: läuft …`, { id })
      await pollRun(r.run_id, id, name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Auslösen fehlgeschlagen", { id })
    } finally {
      runningRef.current.delete(key)
    }
  }

  const rows = useMemo(() => {
    let devs = [...(data?.devices ?? [])]
    const needle = q.trim().toLowerCase()
    if (needle)
      devs = devs.filter((d) =>
        [d.hostname, d.os_user, d.app_version, d.os_name, d.local_ip, d.public_ip, d.isp?.isp, d.isp?.city, d.level?.last_user, d.level?.nickname]
          .some((x) => String(x ?? "").toLowerCase().includes(needle)),
      )
    devs.sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const base =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sort.dir === "asc" ? base : -base
    })
    return devs
  }, [data, q, sort])

  function exportMd(): string {
    const table = mdTable(
      ["Hostname", "Benutzer", "OS", "Lokale IP", "Öffentliche IP", "ISP", "App-Version", "Zuletzt gesehen"],
      rows.map((d) => [
        d.hostname,
        d.os_user,
        [d.os_name, d.os_version].filter(Boolean).join(" ") || null,
        d.local_ip,
        d.public_ip,
        d.isp?.isp,
        d.app_version && d.app_version !== "None" ? d.app_version : null,
        relativeTime(d.last_seen),
      ]),
    )
    return `# Geräte\n\nStand: ${new Date().toLocaleString("de-DE")} · ${rows.length} Geräte\n\n${table}\n`
  }

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />

  return (
    <div>
      <PageHeader
        title="Geräte"
        description={data ? `${data.devices.length} Geräte aus den Enrollment-Meldungen` : undefined}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen…" className="h-10 w-64 pl-9" />
            </div>
            <ExportMdButton filename="geraete" disabled={!data} onExport={exportMd} />
          </>
        }
      />

      {data && (
        <div className="mb-5">
          <RolloutCard devices={data.devices} current={data.current_version} />
        </div>
      )}

      {loading && !data ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : rows.length === 0 ? (
        <EmptyState title="Keine Geräte gefunden" hint={q ? "Suche anpassen." : "Noch keine Enrollment-Meldungen."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table className="nkk-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHead label="Gerät" k="hostname" sort={sort} onSort={toggleSort} className="h-11 pl-4" />
                <SortHead label="App" k="app_version" sort={sort} onSort={toggleSort} />
                <SortHead label="NetBird" k="netbird" sort={sort} onSort={toggleSort} />
                <SortHead label="Zuletzt gemeldet" k="last_seen" sort={sort} onSort={toggleSort} />
                <SortHead label="Ping" k="ping_internet" sort={sort} onSort={toggleSort} align="right" />
                <SortHead label="Speed" k="speed_mbps" sort={sort} onSort={toggleSort} align="right" />
                <SortHead label="Lokale IP" k="local_ip" sort={sort} onSort={toggleSort} />
                <SortHead label="ISP / Standort" k="isp" sort={sort} onSort={toggleSort} />
                <TableHead className="pr-4 text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.hostname} className="group">
                  <TableCell className="py-2.5 pl-4" data-label="Gerät">
                    <div className="flex items-center gap-3">
                      <div className="relative grid size-9 shrink-0 place-items-center rounded-lg border bg-secondary/60 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary">
                        <Laptop className="size-[18px]" />
                        {d.level && (
                          <span
                            className={cn(
                              "absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-card",
                              d.level.online ? "bg-ok" : "bg-muted-foreground/40",
                            )}
                            title={d.level.online ? "In Level online" : "In Level offline"}
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium leading-tight">{d.hostname}</span>
                          {d.updates?.count ? (
                            <span
                              className="shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-bold leading-none text-warn tabular-nums"
                              title={`${d.updates.count} offene Updates in Level`}
                            >
                              ↑{d.updates.count}
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {d.os_user ?? "—"}
                          {d.os_name ? <span className="capitalize"> · {d.os_name}</span> : null}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell data-label="App">{data && <VersionBadge version={d.app_version} current={data.current_version} />}</TableCell>
                  <TableCell data-label="NetBird">
                    {d.netbird?.version ? (
                      <VersionBadge version={d.netbird.version} current={netbirdCurrent} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell data-label="Zuletzt gemeldet">
                    <span className="inline-flex items-center gap-2 text-muted-foreground tabular-nums">
                      <span className={cn("size-1.5 rounded-full", freshness(d.last_seen))} />
                      {relativeTime(d.last_seen)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12.5px] tabular-nums" data-label="Ping">
                    {d.ping_internet != null ? `${fmtNum(d.ping_internet, 0)} ms` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12.5px] tabular-nums" data-label="Speed">
                    {d.speed_mbps != null ? `${fmtNum(d.speed_mbps)} M` : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-[12.5px] text-muted-foreground tabular-nums" data-label="Lokale IP">{d.local_ip ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px]" data-label="ISP / Standort">
                    {d.isp?.isp ? (
                      <div className="truncate">
                        <span className="text-foreground/80">{d.isp.isp}</span>
                        {d.isp.city ? <span className="text-muted-foreground"> · {d.isp.city}</span> : null}
                      </div>
                    ) : (
                      <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">{d.public_ip ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right" data-label="">
                    <DeviceActions d={d} automations={automations} onPing={doPing} onAutomation={doAutomation} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function DeviceActions({
  d,
  automations,
  onPing,
  onAutomation,
}: {
  d: Device
  automations: string[]
  onPing: (d: Device) => void
  onAutomation: (d: Device, name: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent"
          aria-label="Aktionen"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{d.hostname}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {d.local_ip && (
          <DropdownMenuItem onClick={() => onPing(d)}>
            <Activity className="size-3.5" /> Anpingen
          </DropdownMenuItem>
        )}
        {d.level?.gid ? (
          automations.length ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <RefreshCw className="size-3.5" /> Update anstoßen
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {automations.map((a) => (
                  <DropdownMenuItem key={a} onClick={() => onAutomation(d, a)}>
                    {a}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem disabled>
              <RefreshCw className="size-3.5" /> Update (kein Webhook)
            </DropdownMenuItem>
          )
        ) : null}
        {d.level && /^https?:\/\//i.test(d.level.open_url) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={d.level.open_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-3.5" /> In Level öffnen
              </a>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  align,
  className,
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; dir: "asc" | "desc" }
  onSort: (k: SortKey) => void
  align?: "right"
  className?: string
}) {
  const active = sort.key === k
  return (
    <TableHead className={cn(align === "right" && "text-right", className)}>
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-foreground",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          sort.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}
