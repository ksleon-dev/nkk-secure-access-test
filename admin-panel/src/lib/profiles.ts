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

// Smarte Vorauswahl: aus den Gruppennamen des Keys das passende Profil ableiten,
// damit der Admin es meist nicht mehr umstellen muss ("Key gibt Profil vor").
export function roleForGroups(groupNames: string[] | undefined): ProfileRole {
  const g = (groupNames ?? []).join(" ").toLowerCase()
  if (g.includes("infact")) return "infact"
  if (g.includes("administration") || g.includes("it-admin") || g.includes("it admin")) return "it_admin"
  if (g.includes("geschaeft") || g.includes("geschäft") || g.includes("fuehrung") || g.includes("führung")) return "manager"
  return "user"
}
