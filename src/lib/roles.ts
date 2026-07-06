import type { UserRole } from "../types/debug";

/** Alle gueltigen Rollen-Token (Reihenfolge = Anzeige im Admin-Menue). */
export const USER_ROLES: readonly UserRole[] = [
  "user",
  "manager",
  "it_admin",
  "infact",
] as const;

/** Anzeige-Labels der Rollen (Admin-Menue, Panel-Profilwahl). */
export const ROLE_LABELS: Record<UserRole, string> = {
  user: "Nutzer",
  manager: "Geschäftsführer",
  it_admin: "IT Admin",
  infact: "InFact",
};

/**
 * Rohen role-String (aus AppSettings oder Bootstrap-Datei) sicher auf eine
 * gueltige Rolle abbilden. Unbekanntes faellt auf "user" zurueck, damit ein
 * defekter Wert nie versehentlich eine hoeher privilegierte Rolle freischaltet.
 */
export function normalizeRole(raw: string | null | undefined): UserRole {
  return (USER_ROLES as readonly string[]).includes(raw ?? "")
    ? (raw as UserRole)
    : "user";
}

/**
 * Rollen-Gate fuer ein Launch-Ziel. Das branding-`role`-Feld ist eine
 * kommagetrennte Liste von Token (z.B. "admin,infact"). Regeln:
 *  - kein role        => alle sehen es
 *  - it_admin         => sieht ALLES (Admin-Vollzugriff)
 *  - eigene Rolle im Set => sichtbar
 *  - Sondertoken "admin" = beide privilegierten Rollen (manager + it_admin)
 */
/**
 * Beschreibung eines Launch-Ziels fuer die aktuelle Rolle aufbereiten. Fuer das
 * InFact-Profil den redundanten abschliessenden ", InFact"-Zusatz entfernen: ein
 * InFact-Nutzer braucht den Hinweis "hier laeuft InFact" nicht, er sieht z.B. bei
 * App-Server nur "Serv-App". Andere Rollen und Beschreibungen bleiben unveraendert
 * (Admins sehen weiterhin die volle Angabe). Pure + einfach testbar.
 */
export function descriptionForRole(
  desc: string | null | undefined,
  role: UserRole,
): string {
  const d = (desc ?? "").trim();
  if (role === "infact") {
    return d.replace(/[,;]\s*InFact\s*$/i, "").trim();
  }
  return d;
}

export function roleCanSee(
  entryRole: string | undefined | null,
  role: UserRole,
): boolean {
  if (!entryRole) return true;
  if (role === "it_admin") return true;
  const set = new Set(
    entryRole
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (set.has(role)) return true;
  if (set.has("admin") && role === "manager") return true;
  return false;
}
