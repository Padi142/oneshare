interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** The app icon: a ring with a dot passing through its gap. */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden="true"
    >
      <rect width="1024" height="1024" rx="230" fill="var(--accent)" />
      <path
        d="M711.88 476.76A202.96 202.96 0 1 1 547.24 312.12"
        fill="none"
        stroke="#fff"
        strokeWidth="89.44"
        strokeLinecap="round"
      />
      <circle cx="655.51" cy="368.49" r="53.32" fill="#fff" />
    </svg>
  );
}
