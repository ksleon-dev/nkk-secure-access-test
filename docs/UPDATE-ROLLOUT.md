# Geräte auf eine neue Version bringen (nach und nach)

Es gibt zwei Wege, die zusammenspielen. Für den Normalfall musst du gar nichts tun.

## 1. Auto-Update (passiert von allein)

Jede installierte App prüft im Hintergrund (ca. alle 6 h und beim Start) auf neue
Versionen und installiert sie **passiv und still** selbst: kein Wizard, keine
Hinweis-Box, höchstens kurz die Windows-Ja/Nein-Abfrage. Online-Geräte sind also
meist innerhalb eines Tages von allein aktuell.

Im Panel unter **Geräte** siehst du je Gerät die App-Version (grün = aktuell,
gelb = veraltet). Da beobachtest du, wie die Versionen hochklettern.

## 2. Level (gezielt nachschieben, wellenweise)

Level brauchst du nur, um **Nachzügler** (offline/lange aus) sofort zu ziehen oder
einen Rollout aktiv zu steuern, statt auf den Auto-Update-Zyklus zu warten.

Die Level-Skripte sind **idempotent + versions-gated**: ist ein Gerät schon auf der
Zielversion (oder neuer), passiert nichts. Nur ältere werden aktualisiert. Du kannst
das Skript also breit anwenden, es fasst nur die an, die es brauchen.

### Einrichten (einmalig)

1. Im Panel: **Setup-Keys** → bei einem **reusable** Key (z.B. „Buero Onboarding")
   auf **Anzeigen** → Abschnitt **Massen-Rollout über Level**.
2. Den **Windows**- und den **macOS**-Block kopieren (der Key + die Zielversion sind
   schon eingebettet).
3. In Level: **Scripts → New Script**, je eines für Windows und macOS, Inhalt
   einfügen, **Run as: System**.

### Wellenweise ausrollen (empfohlen)

1. **Welle 1 (Test):** Skript auf 2–3 Testgeräte anwenden. Im Panel unter **Geräte**
   prüfen, dass sie auf der neuen Version sind und verbunden bleiben.
2. **Welle 2:** auf die Büro-Gruppe anwenden. Kurz beobachten.
3. **Welle 3:** der Rest (Homeoffice, Lager, …).

Da das Skript Geräte überspringt, die schon aktuell sind, kannst du eine Welle auch
einfach erneut laufen lassen, ohne etwas kaputt zu machen.

### Zielversion anpassen

Im Level-Skript steht die Zielversion. Bei Windows:
`if(-not ($cv -and $cv -ge [version]"0.3.16"))` und bei macOS `NKK_MIN_VERSION='0.3.16'`.
Für ein künftiges Release einfach die Versionsnummer hochsetzen (oder den Block im
Panel neu kopieren, da steht immer die aktuelle drin).

## Faustregel

- Nichts tun → Geräte aktualisieren sich von allein.
- Eilt es / Nachzügler → Level-Skript wellenweise auf Gerätegruppen anwenden.
- Kontrolle → Panel-Seite **Geräte** (Version je Gerät).
