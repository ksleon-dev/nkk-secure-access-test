import { ArrowLeft, ChevronDown, Heart, History, Loader2, Megaphone, Newspaper, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { de } from "../i18n/de";
import type { BrandingDto } from "../types/branding";

interface Props {
  branding: BrandingDto;
  onBack: () => void;
}

interface NewsItem {
  id: string;
  date: string;
  type: "announcement" | "update" | "feedback";
  title: string;
  body: string;
  version?: string;
}

// Ein Update-Log-Eintrag pro Version (vom /api/changelog geliefert, aus dem
// gepflegten CHANGELOG.md geparst). Wird unten aufklappbar angezeigt.
interface ChangelogEntry {
  version: string;
  date: string;
  notes: string[];
}

// Fallback news - used when remote fetch fails or no URL configured. Bewusst
// kurz, menschlich und ohne Versions-Flut: der Live-Feed (Panel) ueberschreibt
// das hier, wenn er erreichbar ist. Keine doppelten Eintraege, keine Version-Badges.
const FALLBACK_NEWS: NewsItem[] = [
  {
    id: "willkommen",
    date: "Juli 2026",
    type: "announcement",
    title: "Willkommen bei NKK Secure Access",
    body: "Diese App bringt dich sicher ins NKK-Netz. Tippe unten auf Verbinden. Sobald es grün ist, erreichst du Terminalserver und Dateiablage mit einem Klick. Fragen oder Probleme? Melde dich bei support@ticket.kronsolutions.de, wir helfen sofort.",
  },
  {
    id: "terminalserver",
    date: "Juli 2026",
    type: "update",
    title: "Terminalserver mit einem Klick",
    body: "Beim Öffnen des Terminalservers ist die Anmeldung (NKKHB) schon vorausgewählt. Du gibst nur deinen Namen und dein Passwort ein, der Rest passt automatisch, ohne lästige Sicherheitswarnungen.",
  },
  {
    id: "dateiablage",
    date: "Juli 2026",
    type: "update",
    title: "Dateiablage mit einem Klick",
    body: "Die gemeinsamen Dateien und Dokumente öffnest du direkt aus der App, ohne Netzlaufwerk-Pfade suchen zu müssen. Ein Klick auf Dateiablage genügt.",
  },
  {
    id: "feedback",
    date: "April 2026",
    type: "feedback",
    title: "Dein Feedback zählt",
    body: "Wir bauen diese App für euch. Wenn etwas nervt oder fehlt, sag Bescheid: im Diagnose-Fenster auf 'Diagnose kopieren' klicken und per Mail an den Support schicken.",
  },
];

const typeConfig = {
  announcement: {
    icon: Megaphone,
    label: "Ankündigung",
    color: "text-[color:var(--brand-primary)]",
    bg: "bg-[color:var(--brand-primary)]/10",
    border: "border-[color:var(--brand-primary)]/30",
  },
  update: {
    icon: Sparkles,
    label: "Update",
    color: "text-emerald-700",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  feedback: {
    icon: Heart,
    label: "Feedback",
    color: "text-amber-700",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
};

export function NewsScreen({ branding, onBack }: Props) {
  const [news, setNews] = useState<NewsItem[]>(FALLBACK_NEWS);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    if (!branding.newsUrl) return;
    let alive = true;
    setLoading(true);
    const validTypes = new Set(["announcement", "update", "feedback"]);
    // Bulletproof: garantierter Timeout auf JEDER WebView. AbortSignal.timeout
    // fehlt auf aelteren WebKits (macOS < 13) UND WebView2 kann bei blockiertem
    // Netz ohne Abbruch haengen -> ohne harten Timeout dreht der Spinner ewig
    // ("News spinnt"). Manueller AbortController + setTimeout wirkt ueberall.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    // Cache-Bust: eindeutiger Query-Param je Abruf. Zusammen mit dem Server-seitigen
    // no-store-Header schlaegt das JEDE WebView-Cache-Schicht (auch WebViews, die
    // no-store bei bereits gecachten Antworten ignorieren) -> nie wieder alte News.
    const bust = (branding.newsUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
    fetch(branding.newsUrl + bust, { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data: unknown) => {
        if (!alive || !Array.isArray(data) || data.length === 0) return;
        const items = data.filter((d): d is NewsItem => {
          if (!d || typeof d !== "object") return false;
          const o = d as Record<string, unknown>;
          return (
            typeof o.id === "string" &&
            typeof o.type === "string" &&
            validTypes.has(o.type) && // guards against typeConfig[type] crash
            typeof o.body === "string" &&
            typeof o.title === "string" &&
            typeof o.date === "string"
          );
        });
        if (items.length > 0) setNews(items);
      })
      .catch((e) => {
        // Fall back to bundled news; log so a broken feed is visible.
        console.warn("News laden fehlgeschlagen:", e);
      })
      .finally(() => {
        clearTimeout(timer);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [branding.newsUrl, reloadKey]);

  // Update-Log (per Version) aus der API holen - nicht eingebacken, immer aktuell.
  useEffect(() => {
    if (!branding.changelogUrl) return;
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const bust = (branding.changelogUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
    fetch(branding.changelogUrl + bust, { signal: controller.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data: unknown) => {
        if (!alive || !Array.isArray(data)) return;
        const items = data.filter((d): d is ChangelogEntry => {
          if (!d || typeof d !== "object") return false;
          const o = d as Record<string, unknown>;
          return (
            typeof o.version === "string" &&
            Array.isArray(o.notes) &&
            (o.notes as unknown[]).every((n) => typeof n === "string")
          );
        });
        // Nur bei nicht-leerem Ergebnis setzen (wie beim News-Pfad): ein transientes
        // leeres API-Ergebnis darf einen bereits geladenen Verlauf nicht wegwischen.
        if (items.length > 0) setChangelog(items);
      })
      .catch((e) => console.warn("Update-Log laden fehlgeschlagen:", e))
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [branding.changelogUrl, reloadKey]);

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md text-[color:var(--brand-fg)] hover:bg-[color:var(--brand-fg)]/8 transition"
          aria-label={de.settings.back}
        >
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
        <Newspaper size={15} className="text-[color:var(--brand-primary)]" />
        <h1 className="text-sm font-bold flex-1">Aktuelles</h1>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={loading}
          className="p-1.5 rounded-md text-[color:var(--brand-fg)] hover:bg-[color:var(--brand-fg)]/8 transition disabled:opacity-40"
          aria-label="Aktualisieren"
          title="Aktualisieren"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-3 mt-1">
          {loading && (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 size={16} className="animate-spin text-[color:var(--brand-primary)]" />
              <span className="text-[11px] text-muted">Lade Neuigkeiten …</span>
            </div>
          )}
          {news.map((item, i) => {
            const cfg = typeConfig[item.type] ?? typeConfig.update;
            const Icon = cfg.icon;
            return (
              <article
                key={item.id}
                className={`fade-in-${Math.min(i + 1, 6)} surface rounded-xl p-3.5 border ${cfg.border}`}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg ${cfg.bg} ${cfg.color} flex items-center justify-center shrink-0 mt-0.5`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wider ${cfg.color} ${cfg.bg} px-1.5 py-0.5 rounded-full`}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-[9px] text-[color:var(--brand-fg)]/40">
                        {item.date}
                      </span>
                    </div>
                    <h2 className="text-[13px] font-bold mt-1 leading-tight">
                      {item.title}
                    </h2>
                    <p className="text-[11px] text-[color:var(--brand-fg)]/75 mt-1 leading-relaxed">
                      {item.body}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-4 text-center">
          <p className="text-[10px] text-[color:var(--brand-fg)]/40 italic">
            Weitere Neuigkeiten folgen bald.
          </p>
        </div>

        {changelog.length > 0 && (
          <div className="mt-5 border-t border-[color:var(--brand-fg)]/10 pt-3">
            <button
              type="button"
              onClick={() => setShowLog((v) => !v)}
              aria-expanded={showLog}
              className="w-full flex items-center justify-between gap-2 text-[11px] font-semibold text-[color:var(--brand-fg)]/55 hover:text-[color:var(--brand-fg)]/85 transition"
            >
              <span className="inline-flex items-center gap-1.5">
                <History size={13} />
                Update-Verlauf
                <span className="text-[color:var(--brand-fg)]/35">({changelog.length})</span>
              </span>
              <ChevronDown
                size={14}
                className={`transition-transform ${showLog ? "rotate-180" : ""}`}
              />
            </button>
            {showLog && (
              <div className="mt-3 flex flex-col gap-3.5">
                {changelog.map((v) => (
                  <div key={v.version}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] font-bold text-[color:var(--brand-primary)]">
                        v{v.version}
                      </span>
                      {v.date && (
                        <span className="text-[9px] text-[color:var(--brand-fg)]/40">
                          {v.date}
                        </span>
                      )}
                    </div>
                    <ul className="mt-1 space-y-1">
                      {v.notes.map((n, i) => (
                        <li
                          key={i}
                          className="flex gap-1.5 text-[10px] leading-relaxed text-[color:var(--brand-fg)]/70"
                        >
                          <span className="mt-[5px] size-1 shrink-0 rounded-full bg-[color:var(--brand-primary)]/50" />
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
        {branding.vendor.footer}
      </div>
    </div>
  );
}
