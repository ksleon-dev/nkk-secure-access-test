/**
 * Subtle bio-themed background decoration. Soft cream blobs for depth, plus
 * three clean, recognisable line motifs that mean something for an organic
 * food wholesaler: a leaf, an apple (echoing the NKK mark) and an ear of wheat.
 * All very low opacity so they sit behind the content, never compete with it.
 */
export function Decor() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 420 640"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {/* Soft cream blobs for gentle depth */}
      <path
        d="M 460 -40 Q 540 80 460 200 Q 360 270 280 180 Q 220 80 320 -20 Q 400 -90 460 -40 Z"
        fill="var(--brand-surface)"
        opacity="0.5"
      />
      <path
        d="M -60 540 Q 30 480 100 540 Q 130 620 50 660 Q -40 680 -80 620 Q -90 570 -60 540 Z"
        fill="var(--brand-surface)"
        opacity="0.45"
      />

      {/* Leaf, top left */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.22"
      >
        <path d="M 18 138 C 28 118 30 96 50 80" />
        <path d="M 50 80 C 38 78 25 86 23 102 C 37 104 49 96 50 80 Z" />
        <path d="M 30 96 L 45 85" />
      </g>

      {/* Apple, top right (echoes the NKK mark) */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.2"
      >
        <path d="M 384 106 C 376 100 365 104 364 115 C 363 129 372 142 381 145 C 384 146 384 144 385 143 C 386 144 387 146 390 145 C 399 142 408 129 407 115 C 406 104 395 100 387 106 Z" />
        <path d="M 385 106 C 386 98 386 94 388 90" />
        <path d="M 387 97 C 393 91 402 92 404 97 C 399 103 391 102 387 97 Z" />
      </g>

      {/* Ear of wheat, bottom right */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.2"
      >
        <path d="M 388 590 L 388 532" />
        <path d="M 388 544 C 380 540 378 532 380 526 C 388 530 390 537 388 544" />
        <path d="M 388 544 C 396 540 398 532 396 526 C 388 530 386 537 388 544" />
        <path d="M 388 556 C 380 552 378 544 380 538 C 388 542 390 549 388 556" />
        <path d="M 388 556 C 396 552 398 544 396 538 C 388 542 386 549 388 556" />
        <path d="M 388 568 C 381 564 379 557 381 551 C 388 555 389 561 388 568" />
        <path d="M 388 568 C 395 564 397 557 395 551 C 388 555 387 561 388 568" />
      </g>
    </svg>
  );
}
