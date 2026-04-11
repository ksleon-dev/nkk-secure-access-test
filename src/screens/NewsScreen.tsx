import { ArrowLeft, Heart, Megaphone, Newspaper, Sparkles } from "lucide-react";
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

// Hardcoded news items — in Phase 2 these could be fetched from a remote
// JSON endpoint so KronSolutions can push messages without app updates.
const NEWS: NewsItem[] = [
  {
    id: "v020",
    date: "11. April 2026",
    type: "update",
    version: "0.2.0",
    title: "Schneller, stabiler, schöner",
    body: "Terminalserver öffnet sich jetzt sofort. Auto Updater eingebaut — Updates kommen automatisch. Speedtest + Smart Debug in der Diagnose. Logo Animation beim Verbinden. Verbindung läuft den ganzen Arbeitstag stabil durch.",
  },
  {
    id: "welcome-1",
    date: "11. April 2026",
    type: "announcement",
    title: "Willkommen bei NKK Secure Access!",
    body: "Wir haben euren alten VPN Client durch eine neue, sichere Lösung ersetzt. Alles was ihr tun müsst: Terminalserver Button klicken und arbeiten. Bei Fragen oder Problemen meldet euch bei support@ticket.kronsolutions.de — wir helfen sofort.",
  },
  {
    id: "feedback-1",
    date: "11. April 2026",
    type: "feedback",
    title: "Euer Feedback ist Gold wert",
    body: "Wir bauen diese App für euch. Wenn etwas nervt, fehlt oder besser sein könnte — sagt Bescheid. Jedes Feedback hilft uns, NKK Secure Access noch besser zu machen. Einfach im Diagnose Panel auf 'Diagnose kopieren' klicken und per Mail schicken.",
  },
  {
    id: "v010",
    date: "7. April 2026",
    type: "update",
    version: "0.1.0",
    title: "Erster Release",
    body: "Terminalserver 1 + 2 Quick Launch, automatische NetBird Installation, VPN Status Anzeige, Diagnose Panel für Support, Anmeldedaten Speicher im System Tresor.",
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
  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label={de.settings.back}
        >
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
        <Newspaper size={15} className="text-[color:var(--brand-primary)]" />
        <h1 className="text-sm font-bold flex-1">Aktuelles</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-3 mt-1">
          {NEWS.map((item, i) => {
            const cfg = typeConfig[item.type];
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
            Mehr Updates folgen — stay tuned.
          </p>
        </div>
      </div>

      <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
        {branding.vendor.footer}
      </div>
    </div>
  );
}
