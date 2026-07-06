import { useData } from "@/lib/data-context"
import { PageHeader, EmptyState, ErrorState, ExportMdButton } from "@/components/common/bits"
import { mdTable } from "@/lib/md-export"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Globe } from "lucide-react"
import type { Device } from "@/lib/types"

function groupCount<T>(items: T[], key: (x: T) => string | null | undefined) {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    if (!k) continue
    m.set(k, (m.get(k) || 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

// Bekannte NKK-Netze mit ehrlicher Praefixlaenge (siehe CLAUDE.md IP-Welt).
// Reihenfolge = spezifischer zuerst gewinnt nicht, wir nehmen den ersten Treffer.
const KNOWN_NETS: { prefix: string; label: string; octets: number }[] = [
  { prefix: "10.101.", label: "10.101.0.0/16", octets: 2 },
  { prefix: "10.0.0.", label: "10.0.0.0/24 (DB-Insel)", octets: 3 },
]

function subnet(ip: string | null | undefined): string | null {
  if (!ip) return null
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  for (const net of KNOWN_NETS) {
    if (ip.startsWith(net.prefix)) return net.label
  }
  // Unbekannte Netze: ehrlicher /24-Bucket, als Heuristik gekennzeichnet.
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24 (heuristisch)`
}

export function NetworkPage() {
  const { data, loading, error, refresh } = useData()
  if (error && !data) return <ErrorState message={error} onRetry={refresh} />
  if (loading && !data) {
    return (
      <div>
        <PageHeader title="Netzwerk" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    )
  }
  if (!data) return null

  const devices = data.devices
  const enriched = devices.filter((d) => d.isp?.isp).length
  const byIsp = groupCount(devices, (d) => d.isp?.isp)
  const byCountry = groupCount(devices, (d) => d.isp?.country)
  const bySubnet = groupCount(devices, (d) => subnet(d.local_ip))
  // Nur echte Kennzeichen (proxy/hosting/mobile) gelten als auffaellig. Die IP-Familie
  // ('IPv4'/'IPv6') aus ipwho.is ist KEIN Auffaelligkeits-Merkmal und wird ausgefiltert,
  // damit nicht die ganze Flotte als 'Auffaellige Verbindung' erscheint.
  const SUSPECT = ["proxy", "hosting", "mobile"]
  const flagged = devices.filter(
    (d) => d.isp?.type && SUSPECT.some((t) => d.isp!.type!.toLowerCase().includes(t)),
  )

  function exportMd(): string {
    const isp = mdTable(["Provider", "Geräte"], byIsp.map(([name, n]) => [name, n]))
    const country = mdTable(["Land", "Geräte"], byCountry.map(([c, n]) => [c, n]))
    const sub = mdTable(["Subnetz", "Geräte"], bySubnet.map(([s, n]) => [s, n]))
    const flags = flagged.length
      ? `\n## Auffällige Verbindungen (${flagged.length})\n\n${mdTable(["Gerät", "Kennzeichen"], flagged.map((d) => [d.hostname, d.isp?.type]))}\n`
      : ""
    return (
      `# Netzwerk & ISP\n\nStand: ${new Date().toLocaleString("de-DE")} · ${enriched}/${devices.length} angereichert\n\n` +
      `## Nach ISP\n\n${isp}\n\n## Nach Land\n\n${country}\n\n## Lokale Subnetze\n\n${sub}\n${flags}`
    )
  }

  return (
    <div>
      <PageHeader
        title="Netzwerk & ISP"
        description={`Aus welchem Netz die Clients kommen. ${enriched}/${devices.length} angereichert${enriched < devices.length ? " (Rest lädt im Hintergrund)" : ""}.`}
        actions={<ExportMdButton filename="netzwerk-isp" onExport={exportMd} />}
      />

      {byIsp.length === 0 ? (
        <EmptyState
          title="ISP-Daten werden noch geladen"
          hint="Die Anreicherung läuft im Hintergrund (rate-limit-schonend) und erscheint nach kurzer Zeit beim Aktualisieren."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Nach ISP" icon={<Globe className="size-4" />}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Geräte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byIsp.map(([isp, n]) => (
                  <TableRow key={isp}>
                    <TableCell className="font-medium">{isp}</TableCell>
                    <TableCell className="text-right tabular-nums">{n}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <div className="grid gap-4">
            <Panel title="Nach Land">
              <ul className="space-y-1.5 text-sm">
                {byCountry.map(([c, n]) => (
                  <li key={c} className="flex items-center justify-between">
                    <span>{c}</span>
                    <span className="tabular-nums text-muted-foreground">{n}</span>
                  </li>
                ))}
                {byCountry.length === 0 && <li className="text-muted-foreground">—</li>}
              </ul>
            </Panel>

            <Panel title="Lokale Subnetze">
              <ul className="space-y-1.5 text-sm">
                {bySubnet.map(([s, n]) => (
                  <li key={s} className="flex items-center justify-between">
                    <span className="font-mono text-[12.5px]">{s}</span>
                    <span className="tabular-nums text-muted-foreground">{n}</span>
                  </li>
                ))}
                {bySubnet.length === 0 && <li className="text-muted-foreground">—</li>}
              </ul>
            </Panel>
          </div>
        </div>
      )}

      {flagged.length > 0 && (
        <div className="mt-4 rounded-xl border border-warn/30 bg-warn/5 p-4">
          <div className="mb-2 text-sm font-semibold text-warn">Auffällige Verbindungen ({flagged.length})</div>
          <div className="flex flex-wrap gap-2">
            {flagged.map((d: Device) => (
              <span key={d.hostname} className="rounded-md border bg-card px-2 py-1 text-xs">
                <span className="font-medium">{d.hostname}</span>
                <span className="ml-1.5 text-warn">{d.isp?.type}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}
