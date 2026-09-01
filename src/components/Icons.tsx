interface IconProps {
  size?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export function IconEditJson({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M8 6 3 12l5 6" />
      <path d="m16 6 5 6-5 6" />
    </svg>
  );
}

export function IconExport({ size = 18 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function IconPlay({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.5v13a.6.6 0 0 0 .92.5l10-6.5a.6.6 0 0 0 0-1l-10-6.5a.6.6 0 0 0-.92.5Z" />
    </svg>
  );
}

export function IconPause({ size = 26 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="7" y="5" width="3.4" height="14" rx="1" />
      <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
    </svg>
  );
}
