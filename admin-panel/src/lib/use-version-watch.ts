import { useEffect } from "react"

// Bulletproof gegen veralteten Browser-Cache: holt periodisch die aktuelle
// index.html (cache-bust + no-store), liest den deployten JS-Bundle-Hash und
// vergleicht ihn mit dem gerade laufenden Bundle. Bei einer neuen Version genau
// EINMAL neu laden -> niemand sieht je wieder eine veraltete Panel-Version, ohne
// hart neu laden zu muessen. Der sessionStorage-Guard verhindert Reload-Schleifen.
export function useVersionWatch(intervalMs = 45000) {
  useEffect(() => {
    const running = Array.from(document.scripts)
      .map((s) => s.src)
      .find((s) => /\/assets\/index-.*\.js$/.test(s))
    if (!running) return

    async function check() {
      try {
        const res = await fetch("/?_v=" + Date.now(), { cache: "no-store" })
        if (!res.ok) return
        const html = await res.text()
        const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)
        if (m && running && !running.endsWith(m[0])) {
          if (sessionStorage.getItem("nkk-reloaded-for") !== m[0]) {
            sessionStorage.setItem("nkk-reloaded-for", m[0])
            location.reload()
          }
        }
      } catch {
        /* offline o.ae. - beim naechsten Tick erneut versuchen */
      }
    }

    const id = window.setInterval(check, intervalMs)
    check()
    return () => window.clearInterval(id)
  }, [intervalMs])
}
