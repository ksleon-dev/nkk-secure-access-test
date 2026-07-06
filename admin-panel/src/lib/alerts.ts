import type { DashboardData } from "./types"
import { daysSince, daysUntil } from "./format"

export type Severity = "high" | "warn" | "info"

export interface Alert {
  id: string
  severity: Severity
  title: string
  detail: string
  actionLabel?: string
  actionTo?: string
}

const RANK: Record<Severity, number> = { high: 0, warn: 1, info: 2 }

export function computeAlerts(d: DashboardData): Alert[] {
  const out: Alert[] = []
  const cur = d.current_version

  const normV = (v?: string | null) => (v && v !== "None" ? v : null)
  const outdated = d.devices.filter((x) => normV(x.app_version) && normV(x.app_version) !== cur).length
  if (outdated > 0) {
    // Wenn Level-Automations vorhanden sind, gibt es einen echten Rollout-Weg
    // (Releases-Seite, Komplett-Rollout via Level). Sonst ehrlich formulieren
    // statt faelschlich "beim naechsten Start automatisch" zu versprechen.
    const canRollout = !!(d.level_automations && d.level_automations.length > 0)
    out.push({
      id: "outdated",
      severity: "high",
      title: `${outdated} Geräte auf veralteter Version`,
      detail: canRollout
        ? `${outdated} von ${d.devices.length} Geräten sind nicht auf ${cur}. Ueber Level lassen sie sich in einem Zug ausrollen.`
        : `${outdated} von ${d.devices.length} Geräten sind nicht auf ${cur}. Update ueber Releases anstossen, ein automatischer Neustart kommt nicht garantiert.`,
      actionLabel: canRollout ? "Update ausrollen" : "Geräte ansehen",
      actionTo: canRollout ? "/releases" : "/devices",
    })
  }

  const uc = d.status.update_channel
  if (uc && !uc.ok) {
    out.push({
      id: "channel",
      severity: "high",
      title: "Auto-Update-Kanal liefert nichts",
      detail: `latest.json: ${uc.error || "nicht erreichbar"}. Ohne Release rollt kein Update aus.`,
      actionLabel: "Releases",
      actionTo: "/releases",
    })
  }

  for (const k of d.keys.filter((x) => x.valid)) {
    const du = daysUntil(k.expires)
    if (du != null && du <= 30) {
      out.push({
        id: "key-" + k.id,
        severity: du <= 7 ? "high" : "warn",
        title: `Setup-Key „${k.name}" läuft in ${du} Tagen ab`,
        detail: "Rechtzeitig erneuern, sonst ist kein Onboarding mehr möglich.",
        actionLabel: "Setup-Keys",
        actionTo: "/keys",
      })
    }
  }

  // Akut offline: Geraete, die per NetBird getrennt sind oder deren Level-Agent
  // offline meldet. Zeigt aktuelle Ausfaelle, nicht nur die aggregierte KPI.
  const offline = d.devices.filter(
    (x) => x.netbird?.connected === false || (x.level && x.level.online === false),
  ).length
  if (offline > 0) {
    out.push({
      id: "devices-offline",
      severity: "warn",
      title: `${offline} Geräte offline oder nicht erreichbar`,
      detail: "Aktuell getrennte Geraete pruefen: VPN-Verbindung oder Gerät aus.",
      actionLabel: "Geräte ansehen",
      actionTo: "/devices",
    })
  }

  for (const p of d.peers) {
    if (p.connected) continue
    const ds = daysSince(p.last_seen)
    if (ds != null && ds >= 45) {
      out.push({
        id: "peer-" + p.id,
        severity: "info",
        title: `Peer „${p.name}" seit ${ds} Tagen offline`,
        detail: "Falls das Gerät weg ist: offboarden, um Ordnung zu halten.",
        actionLabel: "Peers",
        actionTo: "/peers",
      })
    } else if (ds != null && ds < 7) {
      // Akuter Verbindungsabbruch (getrennt vom 45-Tage-Offboarding).
      out.push({
        id: "peer-off-" + p.id,
        severity: "warn",
        title: `Peer „${p.name}" ist offline`,
        detail: ds === 0 ? "Zuletzt heute gesehen, aktuell nicht verbunden." : `Zuletzt vor ${ds} ${ds === 1 ? "Tag" : "Tagen"} gesehen, aktuell nicht verbunden.`,
        actionLabel: "Peers",
        actionTo: "/peers",
      })
    }
  }

  const bk = d.status.backup
  if (bk && bk.age_hours != null && bk.age_hours > 26) {
    out.push({
      id: "backup",
      severity: "warn",
      title: "Backup ist überfällig",
      detail: `Neuestes Backup vor ${Math.round(bk.age_hours)} h (Soll: täglich).`,
      actionLabel: "System",
      actionTo: "/system",
    })
  }

  const disks = d.status.disks || []
  for (const dk of disks) {
    if (dk.used_pct >= 80) {
      out.push({
        id: "disk-" + dk.mount,
        severity: dk.used_pct >= 90 ? "high" : "warn",
        title: `Speicher ${dk.mount} zu ${dk.used_pct}% voll`,
        detail: `Nur noch ${dk.free_gb} GB frei.`,
        actionLabel: "System",
        actionTo: "/system",
      })
    }
  }

  const cert = d.status.cert
  if (cert && cert.days_left != null && cert.days_left <= 14) {
    out.push({
      id: "cert",
      severity: cert.days_left <= 5 ? "high" : "warn",
      title: `Zertifikat läuft in ${cert.days_left} Tagen ab`,
      detail: "Let's-Encrypt-Erneuerung prüfen (öffentlicher :80-Pfad).",
      actionLabel: "System",
      actionTo: "/system",
    })
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}
