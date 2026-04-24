interface ScoreBadgeProps {
  score: number;
  label?: string;
}

/**
 * Score badge — terminal-style bracketed score with tier-colored accent dot.
 *   [·73] — high · alert tier
 *   [·58] — mid · fade tier
 *   [·41] — low · scope tier
 * No pill chips; terminal metrics read as bracketed values, not UI buttons.
 */
export function ScoreBadge({ score, label }: ScoreBadgeProps) {
  const dotClass =
    score >= 70
      ? "bg-alert-500"
      : score >= 50
        ? "bg-fade-500"
        : "bg-scope-500";
  const textClass =
    score >= 70
      ? "text-alert-500"
      : score >= 50
        ? "text-fade-500"
        : "text-scope-400";

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-caption">
      {label && <span className="text-ink-500 uppercase tracking-wide">{label}</span>}
      <span className="text-ink-500">[</span>
      <span className={`w-1 h-1 rounded-full ${dotClass}`} />
      <span className={`num ${textClass}`}>{score.toFixed(0)}</span>
      <span className="text-ink-500">]</span>
    </span>
  );
}
