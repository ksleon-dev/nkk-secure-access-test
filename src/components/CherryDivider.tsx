/**
 * Decorative horizontal divider with a tiny NKK cherry mark in the middle
 * and tan thin lines on either side. Used to break up sections in the brand
 * style of the Naturkost Kontor website.
 */
export function CherryDivider({ width = 200 }: { width?: number }) {
  return (
    <svg
      width={width}
      height={28}
      viewBox="0 0 200 28"
      className="opacity-90"
      aria-hidden="true"
    >
      <line
        x1="6"
        y1="14"
        x2="78"
        y2="14"
        stroke="var(--brand-accent)"
        strokeWidth="1"
      />
      <line
        x1="122"
        y1="14"
        x2="194"
        y2="14"
        stroke="var(--brand-accent)"
        strokeWidth="1"
      />
      {/* tiny stem */}
      <path
        d="M 100 4 Q 106 2 110 6"
        stroke="var(--brand-accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
      {/* leaf */}
      <path
        d="M 108 5 Q 116 -1 120 6 Q 114 10 108 5 Z"
        fill="var(--brand-accent)"
        opacity="0.9"
      />
      {/* cherry body */}
      <circle cx="100" cy="14" r="6" fill="var(--brand-primary)" />
      <circle cx="98" cy="12" r="1.6" fill="#fff" opacity="0.55" />
    </svg>
  );
}
