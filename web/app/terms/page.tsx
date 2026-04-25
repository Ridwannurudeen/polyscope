import Link from "next/link";

export const metadata = {
  title: "Terms — PolyScope",
  description:
    "Terms of use for PolyScope: research, signals, and a non-custodial interface to Polymarket.",
};

function Section({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="flex items-baseline gap-3 mb-3 pb-3 border-b border-ink-800">
        <span className="num text-eyebrow font-mono text-ink-500 tracking-wider">
          §{num}
        </span>
        <h2 className="text-h4 text-ink-100 tracking-tight">{title}</h2>
      </div>
      <div className="text-body text-ink-300 leading-relaxed space-y-3">
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <section className="mb-10 pb-10 border-b border-ink-800">
        <div className="eyebrow mb-3">legal · last updated apr 2026</div>
        <h1 className="text-h1 text-ink-100 tracking-tighter leading-tight">
          terms
        </h1>
      </section>

      <Section num="1" title="what polyscope is">
        <p>
          PolyScope is a research and signal-generation site focused on
          Polymarket prediction markets. We publish divergence signals,
          per-trader accuracy leaderboards, and a transparent methodology of
          how we score markets and traders.
        </p>
      </Section>

      <Section num="2" title="what polyscope is not">
        <ul className="list-disc list-inside marker:text-ink-500 space-y-2">
          <li>
            Not a broker, custodian, exchange, or investment adviser. We do not
            hold funds, private keys, or custody of any kind.
          </li>
          <li>
            Not affiliated with Polymarket. All order submission occurs
            directly between your wallet and Polymarket&apos;s infrastructure.
            Polymarket&apos;s own{" "}
            <a
              href="https://polymarket.com/terms-of-service"
              target="_blank"
              rel="noopener noreferrer"
              className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
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
      </Section>

      <Section num="3" title="non-custodial order routing">
        <p>
          The optional Trade button on decision cards opens a non-custodial
          order flow. When you click it:
        </p>
        <ol className="list-decimal list-inside marker:text-ink-500 marker:font-mono space-y-2">
          <li>
            Your browser connects to an injected wallet you control (MetaMask,
            Rabby, etc).
          </li>
          <li>
            Your wallet signs the order locally. The private key never leaves
            your browser.
          </li>
          <li>
            The signed order is submitted directly to Polymarket&apos;s CLOB
            API with PolyScope&apos;s on-chain builder code attached for
            attribution.
          </li>
          <li>
            PolyScope records the public attribution event for display on the{" "}
            <Link
              href="/builder"
              className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
            >
              /builder
            </Link>{" "}
            page. No personally identifying information is collected.
          </li>
        </ol>
        <p>
          PolyScope receives no fees or rewards from your trades unless
          Polymarket&apos;s Builder Program credits our builder code. You pay
          only the Polymarket protocol fees disclosed on the order preview.
        </p>
      </Section>

      <Section num="4" title="eligibility and geographic restrictions">
        <p>
          Polymarket geo-restricts users in certain jurisdictions (including
          the United States) from placing orders on its platform. PolyScope is
          not a route around those restrictions. You are responsible for
          confirming you are eligible to use Polymarket before using the
          order-routing feature.
        </p>
        <p>
          If you are in a restricted jurisdiction, the Trade feature may be
          disabled for your region. Research features (signals, methodology,
          leaderboards) remain available worldwide.
        </p>
      </Section>

      <Section num="5" title="risk disclosure">
        <p>
          Prediction-market trading involves the risk of total loss of capital.
          Outcomes can resolve unexpectedly. Smart-contract protocols can fail
          or be exploited. Liquidity can disappear.
        </p>
        <p>
          PolyScope&apos;s signals are based on historical patterns in
          top-trader behavior. The methodology page is explicit that the edge
          on tight markets is small and composition-bound. Do not risk capital
          you cannot afford to lose.
        </p>
      </Section>

      <Section num="6" title="no warranties">
        <p>
          The site is provided &ldquo;as is,&rdquo; without warranty of any
          kind. PolyScope is not liable for any loss arising from use of the
          site, signals, order-routing interface, or linked third-party
          services. Data may be incomplete, delayed, or incorrect.
        </p>
      </Section>

      <Section num="7" title="privacy">
        <p>
          We log anonymized page-view events and wallet addresses you
          voluntarily link for watchlist/portfolio sync. No PII is collected.
          No third-party analytics or advertising trackers are loaded.
        </p>
      </Section>

      <div className="text-caption text-ink-500 mt-12 font-mono">
        <Link
          href="/"
          className="text-scope-500 hover:text-scope-400 underline underline-offset-2"
        >
          ← back to home
        </Link>
      </div>
    </div>
  );
}
