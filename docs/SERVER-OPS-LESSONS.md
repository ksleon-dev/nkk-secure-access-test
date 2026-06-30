# NKK Secure Access — Server-Betrieb: Lessons & Guardrails

> Zweck: Damit die Fehler aus der Aufbau-/Stabilisierungsphase (April–Juni 2026) nicht
> nochmal passieren. Wer am `nkk-api`/NetBird-Stack auf **serv-secure (192.168.0.50)**
> etwas anfasst, liest das hier zuerst.
> Stand: 2026-06-29.

---

## Kernregeln (TL;DR — das hier reicht im Alltag)

1. **Keine Secrets in Telemetrie.** Die App sendet **nie** einen Setup-Key (oder sonst ein
   Geheimnis) im Enrollment/Diagnose. Der Server **speichert** so etwas nie.
2. **Öffentliche Endpoints: default-deny.** Jeder neue `/api/*`-Pfad ist erst zu, bis bewusst
   geöffnet. Nichts Sensibles ohne Auth ausliefern.
3. **Jede public-Änderung von AUSSEN testen** (`curl` von einem externen Rechner), nicht nur
   lokal auf dem Host. Lokal `127.0.0.1` lügt (siehe DNS/Hairpin unten).
4. **Backup vor jeder Daten-/Config-Änderung.** Bei Bind-Mounts **in-place** schreiben
   (Truncate), **kein `sed -i`** — das tauscht den Inode und der Container sieht die alte Datei.
5. **Server erreichen NetBird nur intern** über `192.168.0.50`, nicht über die öffentliche IP.
6. **Download:** Bei **jedem** neuen Build die EXE neu aus dem ZIP entpacken, sonst 404.
7. **Setup-Keys sind write-once.** Die PDF ist das einzige Original (chmod 600). Bei Leak:
   rotieren **und** at-rest scrubben.

---

## 1. Das Enrollment-Leck (Root Cause + Fix) — der teuerste Fehler

**Was passiert ist:** `GET /api/enrollments` war ohne Auth offen im Internet und gab
`enrollments.json` aus — darin **80+ Setup-Keys im Klartext** plus komplettes Geräte-/Nutzer-
Inventar (hostname, os_user, local_ip, public_ip, os_version) von ~21 Maschinen.

**Warum es passieren konnte (drei Fehler zusammen):**
- Alte App-Versionen schickten den `setup_key` im Enrollment-POST mit.
- Der Server speicherte **alles** ungefiltert in `enrollments.json`.
- Der Read-Endpoint `/api/enrollments` war **öffentlich ohne Auth**.

**Wie behoben:**
- Caddy-Containment im `api.secure`-Block: `GET /api/enrollments` → 403, `POST /api/news` → 403,
  `POST /api/enrollment` → 403. (Backup: `/opt/netbird/Caddyfile.bak-2026-06-26-pre-apilock`.)
- `enrollments.json` auf `chmod 600`.
- Alle geleakten Keys **rotiert** (2026-06-27, create-then-revoke, `auto_groups` erhalten).
- Klartext-Keys **at-rest gescrubbt** (2026-06-29): `setup_key`/`setup_key_prefix` aus allen
  117 Einträgen entfernt, Telemetrie behalten. Backup:
  `enrollments.json.bak-pre-keyscrub-2026-06-29`.
- Aktuelle App (`send_enrollment_diagnostic`) sendet **keinen** Key mehr.

**Guardrail:** Telemetrie-Payloads vor jedem Release auf Secrets prüfen. Neue `/api`-Endpoints
default-deny und von außen gegentesten. Niemals ein Geheimnis "zur Diagnose" mitschicken.

---

## 2. Was die API darf (Soll-Zustand) — `nkk-api`, Flask, Port 9876

| Endpoint | Funktion | Public-Soll |
|---|---|---|
| `POST /api/enrollment` | App meldet Diagnose-Report (Gerät/User/IPs/OS/Ping/Speed) → `enrollments.json` | **403 (zu)** |
| `GET /api/enrollments` | gibt alle Reports zurück (war das Leck) | **403 (zu)** |
| `GET /api/news` | liefert Meldung (`news.json`), die die App anzeigt | offen |
| `POST /api/news` | setzt die Meldung | **403 (zu)** |
| `GET /api/health` | Health-Check | offen |
| `GET /download/<datei>` | liefert Installer/ZIP aus `/opt/nkk-api/downloads` | offen |
| `GET /download` | JSON-Dateiliste | extern nicht erreichbar |
| `GET /` | Text "NKK Secure Access API" | offen |

Wenn ein zugesperrter Endpoint wieder geöffnet werden muss (z.B. Enrollment-POST für neue
Diagnose), **vorher** klären: Was wird gespeichert? Steht da etwas Sensibles drin? Und danach
**von außen** prüfen, dass nur das Gewollte erreichbar ist.

---

## 3. Datensparsamkeit (DSGVO)

`enrollments.json` ist Mitarbeiter-Inventar (Hostnames, Benutzernamen, IPs). Das ist
personenbezogen. Regel: nur behalten, was wirklich gebraucht wird, mit Retention. Wenn die
Diagnose nur zur Fehlersuche dient, reicht eine **anonymisierte** Variante (ohne user/IP) oder
ein kurzes Aufbewahrungsfenster. Aktuell ruht die Datei (Sammlung seit 26.06. gestoppt).

---

## 4. Download-Verteilung an Mitarbeiter

Zwei Artefakte unter `https://api.secure.nkk-hb.de/download/`:
- `NKK-Secure-Access.zip` — passwortgeschützt (`nkk`), enthält Setup.exe + Anleitung.html.
- `NKK-Secure-Access-Setup.exe` — **direkter Installer, kein Passwort** = der **Mitarbeiter-Link**
  (Windows-Explorer kann Passwort-ZIPs nicht öffnen → sonst Support-Anrufe).

**GOTCHA (genau hier ging es schief):** `/download/<datei>` serviert exakt nach Dateiname.
Die EXE liegt **nicht** automatisch da — sie muss bei **jedem neuen Build** frisch aus dem ZIP
entpackt werden, sonst zeigt der EXE-Link **404**.

```bash
# Auf serv-secure, nach jedem ZIP-Upload:
python3 - <<'PY'
import zipfile, shutil, os
src='/opt/nkk-api/downloads/NKK-Secure-Access.zip'
dst='/opt/nkk-api/downloads/NKK-Secure-Access-Setup.exe'
z=zipfile.ZipFile(src)
exe=[n for n in z.namelist() if n.lower().endswith('.exe')][0]
p=z.extract(exe, '/tmp/nkkexe', pwd=b'nkk')
shutil.move(p, dst); os.chmod(dst, 0o644)
print('deployed', dst, os.path.getsize(dst))
PY
# danach IMMER extern prüfen:
curl -sI https://api.secure.nkk-hb.de/download/NKK-Secure-Access-Setup.exe | head -1   # muss 200 sein
```

Die Mail-Vorlage (`docs/MAIL-VORLAGE.md`) zeigt auf den EXE-Link — beim Versenden prüfen, dass
er 200 liefert. Aktivierungsschlüssel kommt separat (Mail 2) → der offene EXE-Download ist
unkritisch (Installer allein nutzlos ohne Key). EXE unsigniert → SmartScreen-Hinweis in der Mail.

**TODO (offen):** EXE-Entpacken in `scripts/build-release-zip.sh` bzw. den Upload-Schritt
einbauen, damit es nie wieder vergessen wird.

---

## 5. Interne Erreichbarkeit (DNS / Hairpin) — warum Server "offline" wirken

NKK-**Server** (z.B. TS2) erreichen den NetBird-Stack **nicht** über die öffentliche IP:
- Internes AD-DNS gibt für `vpn.secure.nkk-hb.de` **NXDOMAIN** zurück.
- Die öffentliche IP `49.12.135.107` ist von intern **nicht** erreichbar (kein NAT-Hairpin).

→ Folge im April: TS2 war 2 Monate offline. **Sofort-Fix:** hosts-Eintrag auf dem Server
`192.168.0.50  vpn.secure.nkk-hb.de`. **Dauer-Fix:** interner DNS-A-Record am DC
(`vpn.secure.nkk-hb.de → 192.168.0.50`) — eine zentrale Stelle statt hosts pro Server.

Management, Signal und Relay laufen alle unter `vpn.secure.nkk-hb.de:443` (Caddy), also deckt
der eine Eintrag alles ab. Caddy liefert per SNI das echte Zertifikat → TLS bleibt voll
authentifiziert, **kein** Sicherheits-Downgrade.

**Wichtig:** Das ist **nicht** die in den NKK-Docs verbotene hosts-/Portproxy-Krücke (die betraf
serv-db/SMB/Kerberos). Hier ist es eine TLS-authentifizierte HTTPS-Verbindung im selben Segment.
Den Eintrag als bewusste Ausnahme behandeln und **nicht** "aufräumen". Bei Migration zu
`ks-netbird-1` (neue IP) die hosts-Einträge aller Server mitziehen, sonst stiller Ausfall.
Prüfen mit `ping`/`Test-NetConnection` (nicht `Resolve-DnsName`, das ignoriert die hosts-Datei).

---

## 6. Setup-Keys

- Keys sind **write-once**: NetBird zeigt den vollen Wert nur bei Erstellung. Die generierte
  PDF/HTML ist das **einzige Original** → `chmod 600`, sicher ablegen.
- Aktuell **10 gültige Keys** (exp 2027-06-27): 5 wiederverwendbar (IT-Admin, Geschäftsführung,
  Büro, Lager, Server-Recovery) + 5 Homeoffice-one-off (Nr. 1/6/9/14/15). Liste:
  `~/Desktop/NKK-NetBird-SetupKeys-2026-06-27.pdf` (verifiziert: enthält genau diese 10).
- Bei Leak/Verdacht: **rotieren** = neuen Key mit identischer Config inkl. `auto_groups` erstellen,
  **dann** alten revoken (kein Gap, keine Geräte getrennt) — **und** Klartext-Vorkommen at-rest
  scrubben (siehe Abschnitt 1).
- Admin-PAT und API-Keys nie in Chats/Tickets/Code — bei Exposition sofort im Dashboard löschen.

---

## 7. Betriebs-Hygiene allgemein

- **Backup vor jeder Änderung** (Config + Daten). Auf serv-secure läuft täglich 03:30 das
  `nkk-backup.timer` (Zitadel-Dump + NetBird-Store + Config nach `/home/backups`, 21d).
- **Bind-Mounts in-place ändern** (Truncate/`cat >`), nie `sed -i` — sonst sieht der Container
  den alten Inode (Falle bei Caddyfile/management.json).
- **Immer von außen verifizieren.** serv-secure löst `vpn.secure` lokal auf `127.0.0.1` auf —
  ein lokaler Test sagt nichts über den öffentlichen Pfad. Mit `curl`/`--resolve` von einem
  externen Rechner testen.
- **Caddy-Schutz beibehalten:** `strict_sni_host`, HSTS (1 Jahr), das Containment-`route`. Beim
  Editieren nicht versehentlich entfernen.
- **Cert-Renewal** läuft über den öffentlichen Pfad (`49.12.135.107:80`, Let's Encrypt HTTP-01).
  Der hosts-Fix ersetzt das **nicht** — er kaschiert nur auf dem Client, falls der öffentliche
  Pfad kaputt ist. Zert-Ablauf monatlich monitoren.
- **Secrets-Dateirechte:** alle `*.env`, `management.json`, Token = `chmod 600`, kein
  weltlesbares Geheimnis.

---

## Verweise

- App-/Server-Wissen im Auto-Memory: `nkk-serv-secure-api`, `nkk-secure-access-app`,
  `nkk-internal-dns-vpn-secure`.
- Download/Update: `docs/HOW-TO-UPDATE.md`. Mailtexte: `docs/MAIL-VORLAGE.md`.
- Firmenweite Netz-Anti-Patterns: `06-Betrieb/Runbooks/KNOWN-PATTERNS.md`.
