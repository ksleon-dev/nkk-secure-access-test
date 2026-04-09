# `bin/` — gebündelte Binaries

Dieser Ordner wird vom Tauri NSIS Bundler in den Windows Installer
eingebettet. Beim Post-Install führt das Script `src-tauri/nsis/installer.nsh`
dann `msiexec /i resources\bin\netbird-amd64.msi /quiet /norestart` aus, sodass
der Mitarbeiter den Netbird Client nicht selbst installieren muss.

## Vor dem Build

Die MSI ist **nicht committet** (siehe `.gitignore`). Lade sie vor dem
`npm run tauri build` frisch aus Netbirds Package CDN herunter:

```bash
# macOS / Linux
bash src-tauri/bin/fetch-netbird.sh

# Windows PowerShell
pwsh src-tauri/bin/fetch-netbird.ps1
```

In CI (GitHub Actions) macht das der Workflow automatisch.

## Ergebnis

Nach dem Fetch liegt `netbird-amd64.msi` in diesem Ordner. Wenn du dann
`npm run tauri build` auf Windows ausführst, wandert die MSI in das
Installer Bundle und wird auf dem Zielrechner nach der NKK Secure Access
Installation silent mitinstalliert.
