export function Disclaimer() {
  return (
    <div className="mt-10 px-4 py-3 border border-ink-800 rounded-md">
      <p className="text-micro text-ink-400 font-mono leading-relaxed">
        <span className="text-ink-200">polyscope</span> is a non-custodial
        interface and intelligence layer for polymarket. order routing is
        optional — when enabled, your wallet signs every order directly.
        we never hold your keys or funds. attribution via our builder code
        is the only way we benefit from order flow.
      </p>
    </div>
  );
}
