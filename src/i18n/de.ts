export const de = {
  app: {
    loading: "Lade …",
    greeting: "Willkommen",
  },
  greetings: {
    morning: ["Moin", "Guten Morgen", "Frischer Morgen"],
    midday: ["Moin", "Guten Tag", "Mahlzeit"],
    afternoon: ["Hallo", "Schönen Nachmittag"],
    evening: ["Guten Abend", "Feierabend?"],
    night: ["Noch wach?", "Späte Schicht?"],
  },
  bioFootnotes: [
    "100 % Bio Stack 🌱",
    "Verbunden mit Naturkost Kontor 🌿",
    "Frisch verbunden, regional gehostet",
    "Tunnel grün — wie unsere Möhren",
    "Kurze Wege, knackige Latenz",
    "Schmeckt nach kurzer Latenz",
  ],
  credentials: {
    title: "Anmeldedaten",
    subtitle: "Einmal eintragen — gilt für alle NKK Server",
    saved: "Anmeldedaten gespeichert",
    notSet: "Noch keine Anmeldedaten",
    edit: "Ändern",
    delete: "Löschen",
    deleted: "Anmeldedaten gelöscht.",
    confirmDelete:
      "Wirklich löschen? Du musst sie beim nächsten Verbindungsaufbau erneut eingeben.",
    fields: {
      domain: "Domäne",
      username: "Benutzername",
      password: "Passwort",
    },
    storedHint: "Verschlüsselt im System Tresor — verlässt diesen Rechner nicht.",
    requiredForRdp: "Trag einmalig deine NKK Anmeldedaten ein.",
  },
  status: {
    connected: "Verbunden",
    connecting: "Verbinde …",
    disconnected: "Getrennt",
    error: "Fehler",
    cliMissing: "Netbird Client fehlt",
    cliMissingHint:
      "Bitte den Netbird Client installieren und die App neu starten.",
  },
  enrollment: {
    title: "Einrichtung",
    subtitle:
      "Bitte gib deinen persönlichen Setup Key ein. Du hast den Key per Mail von der IT bekommen.",
    placeholder: "Setup Key",
    submit: "Aktivieren",
    submitting: "Aktiviere …",
    error: "Aktivierung fehlgeschlagen",
    keyRequired: "Bitte einen Setup Key eingeben.",
    helpText: "Der Key wird sicher im System Tresor gespeichert.",
  },
  main: {
    connectButton: "Verbinden",
    connectingButton: "Verbinde …",
    disconnectButton: "Trennen",
    quickLaunchTitle: "Schnellzugriff",
    peersTitle: "Aktive Verbindungen",
    noPeers: "Keine Peers verbunden.",
    settings: "Einstellungen",
    localIp: "Eigene IP",
  },
  settings: {
    title: "Einstellungen",
    back: "Zurück",
    autostart: "Beim Anmelden starten",
    autostartHint: "Startet NKK Secure Access automatisch nach dem Login.",
    logsTitle: "Diagnose Logs",
    logsRefresh: "Logs aktualisieren",
    resetTitle: "Einrichtung zurücksetzen",
    resetHint:
      "Trennt den Tunnel und löscht den gespeicherten Setup Key. Du musst dich danach neu aktivieren.",
    resetButton: "Zurücksetzen",
    about: "Über diese App",
    version: "Version",
    management: "Management Server",
    quitApp: "App beenden",
  },
  about: {
    title: "Über",
    close: "Schließen",
    poweredBy: "Powered by",
    support: "Support",
  },
  quickLaunch: {
    rdp: {
      starting: "Starte Remote Desktop …",
      failed: "Remote Desktop konnte nicht gestartet werden.",
    },
    smb: {
      starting: "Öffne Dateifreigabe …",
      failed: "Dateifreigabe konnte nicht geöffnet werden.",
    },
    url: {
      starting: "Öffne Browser …",
      failed: "URL konnte nicht geöffnet werden.",
    },
  },
  toast: {
    connected: "Tunnel ist aktiv.",
    disconnected: "Verbindung getrennt.",
  },
} as const;

export type Translations = typeof de;
