/**
 * PolyScope mark — three variants exported so we can A/B in layout.
 *
 *   <MarkCrosshair />  — reticle / scope crosshair, most literal to name
 *   <MarkAperture />   — concentric apertures, lens / scope feel, abstract
 *   <MarkWedge />      — forward-angled P with scan slit, brand-forward
 *
 * All marks render at 20×20 viewbox, stroke-based so they scale cleanly.
 * Primary stroke uses currentColor → pick brand color at usage site.
 */

type MarkProps = {
  size?: number;
  className?: string;
  accent?: string;
};

export function MarkCrosshair({ size = 20, className, accent = "var(--scope)" }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.25" opacity="0.55" />
      <circle cx="10" cy="10" r="2.25" stroke={accent} strokeWidth="1.25" />
      <path d="M10 1.5V4.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      <path d="M10 15.75V18.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      <path d="M1.5 10H4.25" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      <path d="M15.75 10H18.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      <circle cx="10" cy="10" r="0.9" fill={accent} />
    </svg>
  );
}

export function MarkAperture({ size = 20, className, accent = "var(--scope)" }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <circle cx="10" cy="10" r="5.5" stroke="currentColor" strokeWidth="1.25" opacity="0.7" />
      <path d="M10 4.5 L14.5 10 L10 15.5 L5.5 10 Z" stroke={accent} strokeWidth="1.25" strokeLinejoin="miter" />
      <circle cx="10" cy="10" r="1.25" fill={accent} />
    </svg>
  );
}

export function MarkWedge({ size = 20, className, accent = "var(--scope)" }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Sharp-angled P — stem + head, with horizontal scan slit */}
      <path
        d="M3.5 2.5 V17.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
      <path
        d="M3.5 2.5 H12 L16.5 7 L12 11.5 H3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
      {/* Scan slit — the signature */}
      <path
        d="M5.5 7 H14"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}

/* Full wordmark — mark + type pair. Defaults to crosshair.
   Variant switch controlled by prop. */
export function Wordmark({
  variant = "crosshair",
  size = 18,
  className,
}: {
  variant?: "crosshair" | "aperture" | "wedge";
  size?: number;
  className?: string;
}) {
  const Mark =
    variant === "aperture" ? MarkAperture : variant === "wedge" ? MarkWedge : MarkCrosshair;
  return (
    <span className={`inline-flex items-center gap-2 text-ink-100 ${className ?? ""}`}>
      <Mark size={size} />
      <span
        className="font-mono text-[15px] tracking-tight"
        style={{ letterSpacing: "-0.02em" }}
      >
        polyscope
      </span>
    </span>
  );
}
