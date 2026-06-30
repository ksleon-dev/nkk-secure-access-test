import { toast } from "sonner"

// Kopiert Text robust - auch wenn das Panel ueber das NetBird-Overlay per http
// laeuft (unsicherer Kontext, da fehlt navigator.clipboard). Drei Stufen:
//  1) moderne Clipboard-API (nur https/localhost),
//  2) execCommand-Fallback (funktioniert ueber http),
//  3) Notnagel-Prompt mit vorselektiertem Text (Strg/Cmd+C) - geht IMMER.
export async function copyText(text: string, okLabel = "Kopiert"): Promise<boolean> {
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
  // 3) Notnagel: Prompt mit vorausgewaehltem Text - der Nutzer kann immer Strg/Cmd+C
  try {
    window.prompt("Mit Strg/Cmd+C kopieren, dann Enter:", text)
    return true
  } catch {
    /* ignore */
  }
  toast.error("Kopieren ging nicht. Text bitte manuell markieren.")
  return false
}
