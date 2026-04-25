interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
}

/**
 * StatCard — terminal-style stat. Eyebrow label, big tabular numeral.
 * Used in older surfaces; new pages use the inline StatCell pattern.
 */
export function StatCard({ title, value, subtitle }: StatCardProps) {
  return (
    <div className="surface rounded-md p-4">
      <div className="eyebrow mb-2">{title}</div>
      <p className="num text-h3 text-ink-100 tracking-tight">{value}</p>
      {subtitle && (
        <p className="text-caption text-ink-400 font-mono mt-1.5">{subtitle}</p>
      )}
    </div>
  );
}
