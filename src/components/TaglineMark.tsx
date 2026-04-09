import taglineUrl from "../assets/dein-grosshandel.svg";

interface TaglineMarkProps {
  width?: number;
  className?: string;
}

/**
 * Official "Dein Bio-Großhandel" wordmark from the NKK brand identity.
 * The original SVG ships with the brand tan (#BAAE90) baked into its path
 * fills, so we render it untouched via <img>. Aspect ratio is 432:70.
 */
export function TaglineMark({ width = 220, className }: TaglineMarkProps) {
  const height = Math.round(width * (70 / 432));
  return (
    <img
      src={taglineUrl}
      alt="Dein Bio-Großhandel"
      width={width}
      height={height}
      className={className}
      draggable={false}
    />
  );
}
