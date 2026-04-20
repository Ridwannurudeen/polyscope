import Link from "next/link";

export const metadata = {
  title: "Terms — PolyScope",
  description:
    "Terms of use for PolyScope: research, signals, and a non-custodial interface to Polymarket.",
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-white mb-2">Terms</h1>
      <p className="text-gray-400 mb-8 text-sm">
        Last updated: April 2026.
      </p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">What PolyScope is</h2>
        <p className="text-gray-300 leading-relaxed">
          PolyScope is a research and signal-generation site focused on
          Polymarket prediction markets. We publish divergence signals,
          per-trader accuracy leaderboards, and a transparent methodology of
          how we score markets and traders.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">
          What PolyScope is not
        </h2>
        <ul className="text-gray-300 leading-relaxed list-disc list-inside space-y-2">
          <li>
            PolyScope is not a broker, custodian, exchange, or investment
            adviser. We do not hold funds, private keys, or custody of any
            kind.
          </li>
          <li>
            PolyScope is not affiliated with Polymarket. All order
            submission occurs directly between your wallet and
            Polymarket&apos;s infrastructure. Polymarket&apos;s own{" "}
            <a
              href="https://polymarket.com/terms-of-service"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              Terms of Service
            </a>{" "}
            govern your trading activity on their platform.
          </li>
          <li>
            Signals and decision cards on this site are research output, not
            financial or trading advice. Past accuracy does not imply future
            performance.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">
          Non-custodial order routing
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          The optional &ldquo;Trade&rdquo; button on decision cards opens a
          non-custodial order flow. When you click it:
        </p>
        <ol className="text-gray-300 leading-relaxed list-decimal list-inside space-y-2 mb-3">
          <li>Your browser connects to an injected wallet you control (MetaMask, Rabby, etc).</li>
          <li>
            Your wallet signs the order locally. The private key never
            leaves your browser.
          </li>
          <li>
            The signed order is submitted directly to Polymarket&apos;s CLOB
            API with PolyScope&apos;s on-chain builder code attached for
            attribution.
          </li>
          <li>
            PolyScope records the public attribution event for display on
            the <Link href="/builder" className="text-emerald-400 hover:underline">/builder</Link> page.
            No personally identifying information is collected.
          </li>
        </ol>
        <p className="text-gray-300 leading-relaxed">
          PolyScope receives no fees or rewards from your trades unless
          Polymarket&apos;s Builder Program credits our builder code. You
          pay only the Polymarket protocol fees disclosed on the order
          preview.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">
          Eligibility and geographic restrictions
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          Polymarket geo-restricts users in certain jurisdictions
          (including the United States) from placing orders on its
          platform. PolyScope is not a route around those restrictions. You
          are responsible for confirming you are eligible to use Polymarket
          before using the order-routing feature on PolyScope.
        </p>
        <p className="text-gray-300 leading-relaxed">
          If you are in a restricted jurisdiction, the Trade feature may be
          disabled for your region. Research features (signals, methodology,
          leaderboards) remain available worldwide.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">
          Risk disclosure
        </h2>
        <p className="text-gray-300 leading-relaxed mb-3">
          Prediction-market trading involves the risk of total loss of
          capital. Outcomes can resolve unexpectedly. Smart contract
          protocols can fail or be exploited. Liquidity can disappear.
        </p>
        <p className="text-gray-300 leading-relaxed">
          PolyScope&apos;s signals are based on historical patterns in
          top-trader behavior. The methodology page is explicit that the
          edge on tight markets is small and composition-bound. Do not risk
          capital you cannot afford to lose.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">
          No warranties
        </h2>
        <p className="text-gray-300 leading-relaxed">
          The site is provided &ldquo;as is,&rdquo; without warranty of any
          kind. PolyScope is not liable for any loss arising from use of
          the site, signals, order-routing interface, or linked third-party
          services. Data may be incomplete, delayed, or incorrect.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">
          Privacy
        </h2>
        <p className="text-gray-300 leading-relaxed">
          We log anonymized page-view events and wallet addresses you
          voluntarily link for watchlist/portfolio sync. No PII is
          collected. No third-party analytics or advertising trackers are
          loaded.
        </p>
      </section>

      <div className="text-sm text-gray-500 mt-10">
        <Link href="/" className="text-emerald-400 hover:underline">
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
