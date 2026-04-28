/**
 * Two-stop divergence bar: shows where the crowd sits vs where
 * PolyScope's weighted top-trader consensus sits, on a 0–100% scale.
 * The gap between the two markers is the divergence — visual on the
 * row instead of just a percentage number.
 */
export function DivergenceBar({
  marketPrice,
  smConsensus,
  smDirection,
}: {
  marketPrice: number;
  smConsensus: number;
  smDirection: "YES" | "NO" | string;
}) {
  const crowd = Math.max(0, Math.min(1, marketPrice));
  const ps = Math.max(0, Math.min(1, smConsensus));
  const tone = smDirection === "YES" ? "bg-scope-500" : "bg-fade-500";
  const min = Math.min(crowd, ps);
  const max = Math.max(crowd, ps);

  return (
    <div className="relative w-full max-w-[180px] h-1.5 bg-ink-800 rounded-full overflow-visible">
      {/* gap between crowd and ps highlighted */}
      <span
        className={`absolute top-0 bottom-0 ${tone} opacity-30 rounded-full`}
        style={{
          left: `${min * 100}%`,
          width: `${(max - min) * 100}%`,
        }}
      />
      {/* crowd marker */}
      <span
        className="absolute -top-0.5 w-0.5 h-2.5 bg-ink-300 rounded-sm"
        style={{ left: `calc(${crowd * 100}% - 1px)` }}
        title={`crowd ${(crowd * 100).toFixed(0)}%`}
      />
      {/* polyscope marker (accent) */}
      <span
        className={`absolute -top-1 w-1 h-3.5 ${tone} rounded-sm shadow-glow-scope`}
        style={{ left: `calc(${ps * 100}% - 2px)` }}
        title={`polyscope ${(ps * 100).toFixed(0)}%`}
      />
    </div>
  );
}
