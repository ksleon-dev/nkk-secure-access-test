/**
 * Subtle bio-themed background decoration — cream blob shapes plus
 * abstract red sprig / leaf line drawings in the corners that echo the
 * Naturkost Kontor website illustrations.
 */
export function Decor() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 420 640"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {/* Soft cream blob top right */}
      <path
        d="M 460 -40 Q 540 80 460 200 Q 360 270 280 180 Q 220 80 320 -20 Q 400 -90 460 -40 Z"
        fill="var(--brand-surface)"
        opacity="0.55"
      />
      {/* Soft cream blob bottom left */}
      <path
        d="M -60 540 Q 30 480 100 540 Q 130 620 50 660 Q -40 680 -80 620 Q -90 570 -60 540 Z"
        fill="var(--brand-surface)"
        opacity="0.5"
      />
      {/* Tiny cream accent top left */}
      <path
        d="M 30 60 Q 70 50 75 90 Q 60 120 30 110 Q 5 90 30 60 Z"
        fill="var(--brand-surface)"
        opacity="0.35"
      />

      {/* Bio sprig top left — line drawing leaf cluster in cherry red */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        opacity="0.32"
      >
        <path d="M 14 100 Q 38 88 50 110" />
        <path d="M 22 96 Q 28 80 16 70" />
        <path d="M 32 92 Q 46 80 60 88" />
        <path d="M 38 105 Q 52 100 58 88" />
      </g>

      {/* Bio sprig bottom right — small cherry pair */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        opacity="0.32"
      >
        <path d="M 380 540 Q 388 522 402 528" />
        <path d="M 388 538 Q 380 552 388 564" />
        <circle cx="386" cy="568" r="6" fill="var(--brand-primary)" opacity="0.5" />
        <circle cx="400" cy="558" r="5" fill="var(--brand-primary)" opacity="0.5" />
        <path d="M 372 552 Q 360 558 358 572" opacity="0.7" />
      </g>

      {/* Tiny leaf top right */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        opacity="0.28"
      >
        <path d="M 380 110 Q 396 98 410 108 Q 400 124 380 118 Z" />
        <path d="M 388 112 L 402 110" />
      </g>
    </svg>
  );
}
