interface ScoreBadgeProps {
  score: number;
  label?: string;
}

export function ScoreBadge({ score, label }: ScoreBadgeProps) {
  const color =
    score >= 70
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : score >= 50
        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
        : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}
    >
      {label && <span className="text-gray-400">{label}</span>}
      {score.toFixed(0)}
    </span>
  );
}
