import { de } from "../i18n/de";

export function timeOfDayGreeting(date = new Date()): string {
  const h = date.getHours();
  const pool =
    h < 5
      ? de.greetings.night
      : h < 11
      ? de.greetings.morning
      : h < 14
      ? de.greetings.midday
      : h < 18
      ? de.greetings.afternoon
      : h < 22
      ? de.greetings.evening
      : de.greetings.night;
  const idx = date.getDate() % pool.length;
  return pool[idx];
}

/**
 * The italic red accent line that follows the greeting — mirrors the shop
 * page typography ("Wir machen's / frisch.").
 */
export function italicAccent(
  state: "Connected" | "Connecting" | "Disconnected" | "Error",
  demoMode: boolean
): string {
  if (demoMode) return "demo modus.";
  switch (state) {
    case "Connected":
      return "frisch da.";
    case "Connecting":
      return "moment …";
    case "Error":
      return "hakelig.";
    default:
      return "gleich geht's los.";
  }
}

/**
 * Curated rotating bio-themed footnote. Deterministic per day so it doesn't
 * flicker on re-render and feels intentional.
 */
const BIO_TIPS = [
  "Bio braucht eben manchmal etwas länger. Dafür wird's umso besser.",
  "Wusstest du? NKK liefert seit 1979 Bio nach Bremen.",
  "Tipp: Wurzelpetersilie ist jetzt im Frühjahr am besten.",
  "Frisch verpackt, regional gehostet.",
  "Kurze Wege, knackige Latenz.",
  "Tunnel grün — wie unsere Möhren.",
  "Bio Stack. Hand made in Bremen.",
  "Schmeckt nach kurzer Latenz.",
  "Hopfen und Malz, Tunnel ist da.",
  "Heute schon gestaunt? Wir liefern bio seit 47 Jahren.",
];

export function bioFootnote(date = new Date()): string {
  const idx = date.getDate() % BIO_TIPS.length;
  return BIO_TIPS[idx];
}
