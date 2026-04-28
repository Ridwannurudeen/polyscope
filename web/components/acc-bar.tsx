/**
 * Inline accuracy bar. Width = accuracy %. Fill color reflects band:
 * predictive (>=55) → scope, mid (45-55) → ink, anti-predictive (<45) → fade.
 *
 * Used in trader leaderboards. Hairline-thin (3px) so it adds info
 * without competing with the number it sits below.
 */
export function AccBar({
  pct,
  side = "auto",
}: {
  pct: number;
  side?: "predictive" | "fade" | "auto";
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone =
    side === "predictive"
      ? "bg-scope-500"
      : side === "fade"
      ? "bg-fade-500"
      : pct >= 55
      ? "bg-scope-500"
      : pct >= 45
      ? "bg-ink-400"
      : "bg-fade-500";
  return (
    <div className="acc-bar w-full mt-1.5">
      <span className={tone} style={{ width: `${clamped}%` }} />
    </div>
  );
}
