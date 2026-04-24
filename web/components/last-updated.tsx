interface LastUpdatedProps {
  lastUpdated: Date | null;
  error: string | null;
  retry: () => void;
}

export function LastUpdated({ lastUpdated, error, retry }: LastUpdatedProps) {
  if (error) {
    return (
      <div className="flex items-center gap-2 font-mono text-caption">
        <span className="w-1.5 h-1.5 rounded-full bg-alert-500" />
        <span className="text-alert-500">failed to load</span>
        <button
          onClick={retry}
          className="text-ink-400 hover:text-ink-100 underline underline-offset-2 transition-colors"
        >
          retry
        </button>
      </div>
    );
  }

  if (!lastUpdated) return null;

  return (
    <div className="flex items-center gap-2 font-mono text-caption">
      <span className="w-1.5 h-1.5 rounded-full bg-scope-500 animate-pulse-subtle" />
      <span className="text-ink-400">
        updated{" "}
        <span className="text-ink-200 num">
          {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </span>
    </div>
  );
}
