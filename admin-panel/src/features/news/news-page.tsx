import { useState } from "react"
import { toast } from "sonner"
import { useData } from "@/lib/data-context"
import { api } from "@/lib/api"
import { PageHeader, ErrorState, EmptyState } from "@/components/common/bits"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { Loader2, Megaphone, Sparkles, Heart, Trash2, Send } from "lucide-react"
import type { NewsType } from "@/lib/types"

const TYPES: Record<NewsType, { label: string; icon: typeof Megaphone; cls: string }> = {
  announcement: { label: "Ankündigung", icon: Megaphone, cls: "bg-accent text-primary" },
  update: { label: "Update", icon: Sparkles, cls: "bg-ok/10 text-ok" },
  feedback: { label: "Feedback", icon: Heart, cls: "bg-warn/10 text-warn" },
}

export function NewsPage() {
  const { data, loading, error, refresh } = useData()
  const items = data?.news ?? []
  const [type, setType] = useState<NewsType>("announcement")
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  if (error && !data) return <ErrorState message={error} onRetry={refresh} />

  async function push() {
    if (!message.trim()) {
      toast.error("Meldung darf nicht leer sein.")
      return
    }
    setBusy(true)
    try {
      await api.pushNews(type, title.trim(), message.trim())
      toast.success("News veröffentlicht — erscheint in der App.")
      setTitle("")
      setMessage("")
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteNews(id)
      toast.success("Gelöscht.")
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    }
  }

  return (
    <div>
      <PageHeader title="News" description="Meldungen, die live in der App unter Aktuelles erscheinen." />

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        {/* Verfassen */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold">Neue Meldung</h2>
          <Label className="mb-1.5">Art</Label>
          <Select value={type} onValueChange={(v) => setType(v as NewsType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPES) as NewsType[]).map((t) => (
                <SelectItem key={t} value={t}>{TYPES[t].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Label htmlFor="nt" className="mb-1.5 mt-3">Titel</Label>
          <Input id="nt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Wartung am Freitag" maxLength={80} />

          <Label htmlFor="nm" className="mb-1.5 mt-3">Text</Label>
          <textarea
            id="nm"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            maxLength={600}
            placeholder="Text für die Mitarbeiter…"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <div className="mb-2 mt-1 text-right text-xs text-muted-foreground tabular-nums">{message.length}/600</div>
          <Button className="w-full" onClick={push} disabled={busy || !message.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Veröffentlichen
          </Button>
        </div>

        {/* Verlauf */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Veröffentlicht ({items.length})</h2>
          {loading && !data ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : items.length === 0 ? (
            <EmptyState title="Noch keine News" hint="Verfasse links die erste Meldung — sie erscheint in der App." />
          ) : (
            <ul className="space-y-3">
              {items.map((n) => {
                const t = TYPES[n.type] ?? TYPES.announcement
                const Icon = t.icon
                return (
                  <li key={n.id} className="group flex gap-3 rounded-xl border bg-card p-4">
                    <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", t.cls)}>
                      <Icon className="size-[18px]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", t.cls)}>{t.label}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{n.date}</span>
                      </div>
                      <div className="mt-1 font-medium leading-tight">{n.title}</div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                    </div>
                    <button
                      onClick={() => remove(n.id)}
                      className="self-start rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-destructive group-hover:opacity-100"
                      aria-label="Meldung löschen"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
