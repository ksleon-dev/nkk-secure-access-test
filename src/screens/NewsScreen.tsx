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

// Fallback news - used when remote fetch fails or no URL configured.
// Versions match CHANGELOG.md so nothing in the history looks skipped.
const FALLBACK_NEWS: NewsItem[] = [
  {
    id: "v0319-veredelt",
    date: "6. Juli 2026",
    type: "update",
    version: "0.3.19",
    title: "Runder, klarer, sicherer",
    body: "Viele Meldungen sagen dir jetzt noch klarer, was zu tun ist, und Verbindungen laufen zuverlässiger. Unter der Haube sind zahlreiche Kleinigkeiten stabiler und sicherer geworden, und das App-Symbol sitzt jetzt sauber im Dock. IT-Admins finden im Admin-Modus neue Direktzugriffe auf die Server.",
  },
  {
    id: "v0318-anmeldung",
    date: "30. Juni 2026",
    type: "update",
    version: "0.3.18",
    title: "Anmeldung klappt jetzt zuverlässig",
    body: "Beim Öffnen des Terminalservers ist die richtige Anmeldung (NKKHB) immer vorausgewählt. Du tippst nur noch deinen Namen und dein Passwort, der Rest passt automatisch. Die lästigen Sicherheitshinweise beim Öffnen sind weg, und der Server öffnet sauber auf allen deinen Bildschirmen.",
  },
  {
    id: "v0318-ruhig",
    date: "30. Juni 2026",
    type: "update",
    version: "0.3.18",
    title: "Ruhiger, klarer, schneller",
    body: "Das Fenster ist aufgeräumt und bleibt beim Verbinden ruhig, nichts springt mehr. Der erste Verbindungsaufbau nach der Einrichtung geht schneller und führt dich Schritt für Schritt. Updates kommen automatisch und zuverlässig bei dir an.",
  },
  {
    id: "v031",
    date: "25. Juni 2026",
    type: "update",
    version: "0.3.1",
    title: "Schlauer im Netz, bequemer im Alltag",
    body: "Die App erkennt jetzt selbst, ob du im Büro oder unterwegs bist, und warnt, wenn zwei Netze gleichzeitig laufen und die Verbindung ausbremsen. In den Einstellungen stellst du ein, was im Remote Desktop mitgeht (Zwischenablage, Drucker und mehr). Und du kannst dir eine Desktop-Verknüpfung zum Terminalserver anlegen.",
  },
  {
    id: "v030",
    date: "18. Juni 2026",
    type: "update",
    version: "0.3.0",
    title: "Mehrere Bildschirme und bessere Diagnose",
    body: "Remote Desktop nutzt jetzt alle deine Monitore, Text und Dateien lassen sich zuverlässig kopieren. Im Büro gehen die Server-Buttons sogar ohne VPN. Und wenn mal etwas klemmt, zeigt das Diagnose-Fenster einen Verlauf und erkennt WLAN-Anmeldeseiten.",
  },
  {
    id: "v028",
    date: "12. Mai 2026",
    type: "update",
    version: "0.2.8",
    title: "Stabiler im Dauerbetrieb",
    body: "Trennen bleibt jetzt auch nach Neustart getrennt, und die App verbindet sich nach dem Aufklappen des Laptops schneller wieder. Viele kleine Stabilitätsverbesserungen unter der Haube.",
  },
  {
    id: "v027",
    date: "2. Mai 2026",
    type: "update",
    version: "0.2.7",
    title: "Updates kommen jetzt zuverlässig an",
    body: "Die automatische Aktualisierung wurde repariert, neue Versionen landen jetzt sauber bei dir. Eine abgelaufene Sitzung wird klar als neu anmelden angezeigt, statt still zu hängen.",
  },
  {
    id: "v026",
    date: "28. April 2026",
    type: "update",
    version: "0.2.6",
    title: "Sauberes Trennen und Copy/Paste",
    body: "Der Trennen-Knopf trennt jetzt wirklich, und der Auto-Reconnect respektiert das. Text und Dateien kopieren zwischen PC und Terminalserver klappt zuverlässig. Der Installer räumt alte Installationen vor dem Upgrade auf.",
  },
  {
    id: "welcome-1",
    date: "11. April 2026",
    type: "announcement",
    title: "Willkommen bei NKK Secure Access!",
    body: "Wir haben euren alten VPN Client durch eine neue, sichere Lösung ersetzt. Alles was ihr tun müsst: Terminalserver-Button klicken und arbeiten. Bei Fragen oder Problemen meldet euch bei support@ticket.kronsolutions.de, wir helfen sofort.",
  },
  {
    id: "feedback-1",
    date: "11. April 2026",
    type: "feedback",
    title: "Euer Feedback ist Gold wert",
    body: "Wir bauen diese App für euch. Wenn etwas nervt, fehlt oder besser sein könnte, sagt Bescheid. Einfach im Diagnose Panel auf 'Diagnose kopieren' klicken und per Mail schicken.",
  },
  {
    id: "v010",
    date: "9. April 2026",
    type: "update",
    version: "0.1.0",
    title: "Erster Release",
    body: "Terminalserver-Schnellstart, automatische NetBird-Installation, VPN-Status-Anzeige, Diagnose-Panel für den Support, Anmeldedaten sicher im System-Tresor.",
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
    setLoading(true);
    const validTypes = new Set(["announcement", "update", "feedback"]);
    // Feature-detect: AbortSignal.timeout is unavailable on older WebViews
    // (macOS < 13 / old WebKit). Evaluating it inline would throw synchronously
    // before the promise chain exists, so .finally() never runs and the loading
    // spinner would hang forever. Build the init object defensively.
    const signal =
      typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(8000)
        : undefined;
    fetch(branding.newsUrl, signal ? { signal } : undefined)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length > 0) {
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
        }
      })
      .catch((e) => {
        // Fall back to bundled news; log so a broken feed is visible.
        console.warn("News laden fehlgeschlagen:", e);
      })
      .finally(() => setLoading(false));
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
                      {item.version && (
                        <span className="text-[9px] font-mono font-bold text-[color:var(--brand-fg)]/50 bg-[color:var(--brand-fg)]/5 px-1.5 py-0.5 rounded-full">
                          v{item.version}
                        </span>
                      )}
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
