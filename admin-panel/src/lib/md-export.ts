// Kleiner Helfer, um jede Ansicht als Markdown herunterzuladen. Bewusst
// dependency-frei: baut eine saubere Tabelle und stoesst einen Blob-Download an.

type Cell = string | number | null | undefined

function cell(v: Cell): string {
  if (v == null) return ""
  // Pipes wuerden die Tabelle sprengen, Zeilenumbrueche ebenso -> entschaerfen.
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

// Baut eine saubere Markdown-Tabelle. null/undefined werden zu leer, Pipes
// in Zellen escaped. Fehlende Zellen einer Zeile bleiben leer.
export function mdTable(headers: string[], rows: Cell[][]): string {
  const head = `| ${headers.map(cell).join(" | ")} |`
  const sep = `| ${headers.map(() => "---").join(" | ")} |`
  const body = rows.map(
    (r) => `| ${headers.map((_, i) => cell(r[i])).join(" | ")} |`,
  )
  return [head, sep, ...body].join("\n")
}

// Loest einen Download der Markdown-Datei aus (Dateiname endet immer auf .md).
export function downloadMd(filename: string, content: string): void {
  const name = filename.toLowerCase().endsWith(".md") ? filename : `${filename}.md`
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
