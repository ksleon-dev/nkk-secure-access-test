// App-Profile (= Rolle in der NKK Secure Access App). Muss mit der App
// (src/lib/roles.ts USER_ROLES) uebereinstimmen. Das Panel bettet die Rolle in
// den Onboarding-One-Liner ein; die App setzt sie beim ersten Start.
export type ProfileRole = "user" | "manager" | "it_admin" | "infact"

export const PROFILE_OPTIONS: { value: ProfileRole; label: string }[] = [
  { value: "user", label: "Standard" },
  { value: "manager", label: "Geschäftsführung" },
  { value: "it_admin", label: "Administrator" },
  { value: "infact", label: "InFact" },
]

// Opakes Token pro Rolle. MUSS synchron mit src-tauri/src/commands.rs role_for_token
// bleiben. Der One-Liner traegt das TOKEN statt der Klartext-Rolle, damit niemand die
// Rolle ablesen oder sich auf it_admin umschreiben kann. Echter Schutz = NetBird-Gruppe.
export const PROFILE_TOKENS: Record<ProfileRole, string> = {
  user: "",
  manager: "hK7pR2xW",
  it_admin: "zB4nT9qL",
  infact: "vY6cF3mP",
}

// Token fuer den One-Liner; Standard (user) braucht keins.
export function profileToken(role: ProfileRole): string | undefined {
  return PROFILE_TOKENS[role] || undefined
}

// Smarte Vorauswahl: aus den Gruppennamen des Keys das passende Profil ableiten,
// damit der Admin es meist nicht mehr umstellen muss ("Key gibt Profil vor").
export function roleForGroups(groupNames: string[] | undefined): ProfileRole {
  const g = (groupNames ?? []).join(" ").toLowerCase()
  if (g.includes("infact")) return "infact"
  if (g.includes("administration") || g.includes("it-admin") || g.includes("it admin")) return "it_admin"
  if (g.includes("geschaeft") || g.includes("geschäft") || g.includes("fuehrung") || g.includes("führung")) return "manager"
  return "user"
}
