import { ArrowLeft, Copy } from "lucide-react";
import { useToast } from "./Toast";

// Full-window, scrollable view for command output. The inline preview at the
// bottom of a screen is always too cramped in a 420x640 window, so long output
// (smart debug, level runs, service actions) opens here where it is readable.
export function OutputOverlay({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const toast = useToast();
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[color:var(--brand-bg)] screen-anim">
      <header className="flex items-center gap-2 px-4 py-3 shrink-0 border-b border-[color:var(--brand-border)]">
        <button
          onClick={onClose}
          className="btn-ghost rounded-md p-1.5"
          aria-label="Zurück"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="flex-1 truncate font-bold text-[15px] text-[color:var(--brand-fg)]">
          {title}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(text);
            toast.success("Kopiert.");
          }}
          className="btn-ghost rounded-md px-2 py-1.5 flex items-center gap-1 text-[12px] font-semibold text-[color:var(--brand-fg)]"
        >
          <Copy size={15} /> Kopieren
        </button>
      </header>
      <pre className="allow-select flex-1 overflow-auto m-3 p-3 surface rounded-lg text-[12px] font-mono whitespace-pre-wrap break-words leading-relaxed text-[color:var(--brand-fg)]">
        {text || "Keine Ausgabe."}
      </pre>
    </div>
  );
}
