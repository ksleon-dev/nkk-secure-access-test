/**
 * Subtle bio-themed background. Soft cream blobs for depth plus clean, low
 * opacity line motifs that mean something for an organic food wholesaler:
 * leaf, apple (echoes the NKK mark), ear of wheat, grapes, a carrot and a pear.
 * Everything sits at the edges and very low opacity so it reads as texture and
 * never competes with the content in front of it.
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
      <path
        d="M 430 360 Q 480 410 440 470 Q 390 510 350 460 Q 330 410 380 372 Q 410 350 430 360 Z"
        fill="var(--brand-surface)"
        opacity="0.4"
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

      {/* Pear, mid left */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.16"
      >
        <path d="M 34 300 C 32 304 32 309 35 313 C 25 318 22 333 30 344 C 38 354 51 352 55 341 C 59 330 51 318 42 314 C 45 310 44 304 41 301" />
        <path d="M 38 300 L 38 292" />
        <path d="M 38 295 C 44 290 50 293 50 299 C 43 301 38 299 38 295 Z" />
      </g>

      {/* Grapes, mid right */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.16"
      >
        <path d="M 392 286 L 392 296" />
        <path d="M 392 289 C 400 285 407 289 407 295 C 399 298 392 295 392 289 Z" />
        <circle cx="383" cy="304" r="6.5" />
        <circle cx="396" cy="304" r="6.5" />
        <circle cx="389" cy="315" r="6.5" />
        <circle cx="402" cy="315" r="6.5" />
        <circle cx="395" cy="326" r="6.5" />
      </g>

      {/* Carrot, bottom left */}
      <g
        stroke="var(--brand-primary)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.18"
      >
        <path d="M 24 560 Q 44 564 36 602 Q 32 610 28 602 Q 18 572 24 560 Z" />
        <path d="M 27 572 L 34 574" />
        <path d="M 28 583 L 33 585" />
        <path d="M 25 560 C 20 550 18 544 16 538" />
        <path d="M 30 558 C 30 547 30 541 30 535" />
        <path d="M 34 560 C 38 551 41 546 44 541" />
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
