import { useEffect, useState } from "react"
import { useNavigate } from "react-router"
import { useData } from "@/lib/data-context"
import { NAV } from "@/config/nav"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { Search, MonitorSmartphone, Radio, KeyRound, Users, Megaphone, Laptop, Server } from "lucide-react"

/**
 * OS-Erkennung aus os_name (Device) bzw. os (Peer). Ergebnis steuert Icon,
 * Kurz-Label (Win/Mac/Linux) und Such-Synonyme, damit 'windows'/'win',
 * 'mac'/'apple'/'macos', 'linux' live auf die passenden Eintraege matchen.
 */
type OsKind = "windows" | "macos" | "linux" | "unknown"

function detectOs(raw: string | null | undefined): OsKind {
  const s = (raw ?? "").toLowerCase()
  if (!s) return "unknown"
  // macOS ZUERST: 'darwin' enthaelt 'win' und wuerde sonst als Windows erkannt.
  if (s.includes("mac") || s.includes("darwin") || s.includes("apple") || s.includes("osx")) return "macos"
  if (s.includes("windows") || /\bwin/.test(s)) return "windows"
  if (s.includes("linux") || s.includes("ubuntu") || s.includes("debian") || s.includes("fedora")) return "linux"
  return "unknown"
}

/** Such-Synonyme pro OS, in den cmdk-value gehaengt (Live-Filter per Tippen). */
function osSynonyms(kind: OsKind): string {
  switch (kind) {
    case "windows":
      return "windows win"
    case "macos":
      return "apple mac macos osx darwin"
    case "linux":
      return "linux"
    default:
      return ""
  }
}

/** Kurz-Badge (Win/Mac/Linux), wertig und ohne Emoji. */
function OsBadge({ kind }: { kind: OsKind }) {
  if (kind === "unknown") return null
  const label = kind === "windows" ? "Win" : kind === "macos" ? "Mac" : "Linux"
  return (
    <span className="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
      {label}
    </span>
  )
}

/** Neutrales OS-Icon (lucide hat keine Marken-Icons). */
function osIcon(kind: OsKind) {
  switch (kind) {
    case "windows":
      return MonitorSmartphone
    case "macos":
      return Laptop
    case "linux":
      return Server
    default:
      return MonitorSmartphone
  }
}

/**
 * Globale Suche (Command-Palette) fuer die ganze Konsole. Cmd/Ctrl+K oder der Button
 * oben oeffnet sie; cmdk uebernimmt das Fuzzy-Matching. Durchsucht Seiten, Geraete
 * (Hostname, Benutzer, IP, ISP, OS), Peers, Setup-Keys, Gruppen und News und springt beim
 * Auswaehlen direkt zum Ziel (Geraet: gefiltert auf die Geraeteliste). Geraete und Peers
 * sind OS-schlau: passendes Icon plus Win/Mac/Linux-Badge, und 'windows'/'win',
 * 'mac'/'apple'/'macos', 'linux' filtern live ueber angehaengte OS-Synonyme.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const { data } = useData()

  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null
      if (!t) return false
      const tag = t.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable
    }
    const onKey = (e: KeyboardEvent) => {
      // Auto-Repeat ignorieren (Taste gedrueckt gehalten toggelt sonst wild).
      if (e.repeat) return
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+K nicht kapern, waehrend in einem Formularfeld getippt wird
        // (der Fokus wuerde sonst aus News-Compose/Rename/Key-Formular gerissen).
        if (isEditable(e.target)) return
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  function go(to: string) {
    setOpen(false)
    navigate(to)
  }

  const devices = data?.devices ?? []
  const peers = data?.peers ?? []
  const keys = data?.keys ?? []
  const groups = data?.groups ?? []
  const news = data?.news ?? []

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground"
        title="Suchen (Cmd/Ctrl + K)"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Suchen</span>
        <kbd className="ml-1 hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none sm:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Suche"
        description="Geräte, Peers, Keys und Seiten durchsuchen"
      >
        <CommandInput
          placeholder="Suchen: Gerät, Benutzer, IP, Peer, Key, Seite …"
          value={query}
          onValueChange={setQuery}
        />
        {(devices.length > 0 || peers.length > 0) && (
          <div className="flex items-center gap-1.5 border-b px-3 py-2">
            <span className="text-xs text-muted-foreground">OS:</span>
            {[
              { label: "Alle", term: "" },
              { label: "Windows", term: "windows" },
              { label: "Mac", term: "macos" },
              { label: "Linux", term: "linux" },
            ].map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setQuery(f.term)}
                className="rounded border bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <CommandList>
          <CommandEmpty>Nichts gefunden.</CommandEmpty>

          <CommandGroup heading="Seiten">
            {NAV.map((n) => (
              <CommandItem
                key={n.to}
                value={`seite ${n.label} ${n.to}`}
                onSelect={() => go(n.to)}
              >
                <n.icon className="text-muted-foreground" />
                <span>{n.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          {devices.length > 0 && (
            <CommandGroup heading="Geräte">
              {devices.map((d, i) => {
                const os = detectOs(d.os_name)
                const OsIcon = osIcon(os)
                return (
                  <CommandItem
                    key={`dev-${d.hostname}-${d.os_user ?? ""}-${i}`}
                    value={`geraet ${d.hostname} ${d.os_user ?? ""} ${d.local_ip ?? ""} ${d.public_ip ?? ""} ${d.isp?.isp ?? ""} ${d.os_name ?? ""} ${osSynonyms(os)}`}
                    onSelect={() => go(`/devices?q=${encodeURIComponent(d.hostname)}`)}
                  >
                    <OsIcon className="text-muted-foreground" />
                    <span className="font-medium">{d.hostname}</span>
                    <OsBadge kind={os} />
                    <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                      {[d.os_user, d.local_ip].filter(Boolean).join(" · ")}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {peers.length > 0 && (
            <CommandGroup heading="Peers">
              {peers.map((p) => {
                const os = detectOs(p.os)
                return (
                  <CommandItem
                    key={`peer-${p.id}`}
                    value={`peer ${p.name} ${p.ip ?? ""} ${p.os ?? ""} ${osSynonyms(os)}`}
                    onSelect={() => go("/peers")}
                  >
                    <Radio className="text-muted-foreground" />
                    <span>{p.name}</span>
                    <OsBadge kind={os} />
                    <span className="ml-auto pl-2 text-xs text-muted-foreground">{p.ip ?? ""}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {keys.length > 0 && (
            <CommandGroup heading="Setup-Keys">
              {keys.map((k) => (
                <CommandItem
                  key={`key-${k.id}`}
                  value={`key setup-key ${k.name} ${k.groups.join(" ")}`}
                  onSelect={() => go("/keys")}
                >
                  <KeyRound className="text-muted-foreground" />
                  <span>{k.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {groups.length > 0 && (
            <CommandGroup heading="Gruppen">
              {groups.map((g) => (
                <CommandItem
                  key={`grp-${g.id}`}
                  value={`gruppe ${g.name}`}
                  onSelect={() => go("/peers")}
                >
                  <Users className="text-muted-foreground" />
                  <span>{g.name}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">
                    {g.peers_count} Peers
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {news.length > 0 && (
            <CommandGroup heading="News">
              {news.map((n) => (
                <CommandItem
                  key={`news-${n.id}`}
                  value={`news ${n.title} ${n.body}`}
                  onSelect={() => go("/news")}
                >
                  <Megaphone className="text-muted-foreground" />
                  <span className="truncate">{n.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
