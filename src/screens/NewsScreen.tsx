import { ArrowLeft, Heart, Loader2, Megaphone, Newspaper, Sparkles } from "lucide-react";
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
    fetch(branding.newsUrl, { signal: controller.signal, cache: "no-store" })
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
  }, [branding.newsUrl]);

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
      </div>

      <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
        {branding.vendor.footer}
      </div>
    </div>
  );
}
