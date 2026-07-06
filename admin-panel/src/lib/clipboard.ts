import { toast } from "sonner"

// Kopiert Text robust - auch wenn das Panel ueber das NetBird-Overlay per http
// laeuft (unsicherer Kontext, da fehlt navigator.clipboard). Drei Stufen:
//  1) moderne Clipboard-API (nur https/localhost),
//  2) execCommand-Fallback (funktioniert ueber http),
//  3) Notnagel-Prompt mit vorselektiertem Text (Strg/Cmd+C) - geht IMMER.
//
// Fuer geheime Werte (Setup-Keys, Mailtexte mit Key) sollte der prompt-Notnagel
// unterdrueckt werden (allowPrompt:false): das Panel laeuft bewusst per http/Overlay
// (isSecureContext oft false), sonst landet das Secret in einem sichtbaren
// Klartext-Prompt (ggf. Prompt-History). Der bereits sichtbare Code-Block bleibt
// dann markierbar und der Nutzer kopiert manuell.
export async function copyText(
  text: string,
  okLabel = "Kopiert",
  opts: { allowPrompt?: boolean } = {},
): Promise<boolean> {
  const allowPrompt = opts.allowPrompt !== false
  // 1) Moderne API
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      toast.success(okLabel)
      return true
    }
  } catch {
    /* faellt unten weiter */
  }
  // 2) execCommand-Fallback (verstecktes Textarea, offscreen, KEIN opacity:0 -
  // das verhindert in manchen Browsern die Auswahl)
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.left = "-9999px"
    ta.style.top = "0"
    document.body.appendChild(ta)
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    if (ok) {
      toast.success(okLabel)
      return true
    }
  } catch {
    /* faellt unten weiter */
  }
  // 3) Notnagel: Prompt mit vorausgewaehltem Text - der Nutzer kann immer Strg/Cmd+C.
  // Fuer Secrets deaktiviert, damit kein Klartext in einem sichtbaren Prompt landet.
  if (allowPrompt) {
    try {
      window.prompt("Mit Strg/Cmd+C kopieren, dann Enter:", text)
      return true
    } catch {
      /* ignore */
    }
  }
  toast.error("Kopieren ging nicht. Text bitte manuell markieren und kopieren.")
  return false
}
