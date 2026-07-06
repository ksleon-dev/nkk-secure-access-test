export function relativeTime(s?: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (isNaN(d.getTime())) return "—"
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return "gerade eben"
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} h`
  const days = Math.floor(diff / 86400)
  if (days < 31) return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`
  return `vor ${Math.floor(days / 30)} Mon.`
}

export function daysSince(s?: string | null): number | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

export function daysUntil(s?: string | null): number | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

export function fmtNum(x?: number | null, digits = 1): string {
  if (x == null || x === undefined) return "—"
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(x)
}

function verParts(v: string): number[] {
  return v.split(".").map((p) => parseInt(p.replace(/\D/g, ""), 10) || 0)
}
function verCmp(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

// Echter Versionsvergleich (kein hardcodiertes "0.2."): gleich/neuer = aktuell,
// nur Patch zurueck = "old" (amber), Major/Minor zurueck = "older" (rot).
export function versionKind(v: string | null | undefined, current: string): "current" | "old" | "older" | "unknown" {
  if (!v || v === "None" || v === "null") return "unknown"
  if (!current) return "unknown"
  const a = verParts(v)
  const b = verParts(current)
  if (verCmp(a, b) >= 0) return "current"
  const majorMinorBehind = (a[0] ?? 0) < (b[0] ?? 0) || ((a[0] ?? 0) === (b[0] ?? 0) && (a[1] ?? 0) < (b[1] ?? 0))
  return majorMinorBehind ? "older" : "old"
}
