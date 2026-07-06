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
 * The italic red accent line that follows the greeting - mirrors the shop
 * page typography ("Wir machen's / frisch.").
 */
export function italicAccent(
  state: "Connected" | "Connecting" | "Disconnected" | "Error"
): string {
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
