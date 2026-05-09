import { ImageResponse } from "next/og";

export const runtime = "nodejs";
// Cache the rendered card for 60s. The first share-on-X triggers a
// fresh render (~300ms with warm API cache); every viewer after gets
// it from Next's cache. This is safe because the underlying numbers
// only meaningfully change on the 5-min divergence scan cycle.
export const revalidate = 60;

// Prefer the in-cluster Docker DNS name (http://api:8020) so the OG
// render doesn't round-trip through nginx + the public domain on
// every request. Falls back to the public URL for local dev / preview.
const API_BASE =
  process.env.POLYSCOPE_API_URL ||
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://polyscope.gudman.xyz";

interface DivergenceSignal {
  market_id?: string;
  question: string;
  market_price: number;
  sm_consensus: number;
  sm_direction: string;
  divergence_pct: number;
  sm_trader_count: number;
}

function pct(value: number | null | undefined) {
  if (value == null) return "--";
  return `${Math.round(value * 100)}%`;
}

function num(value: number | null | undefined) {
  if (value == null) return "--";
  return value.toLocaleString();
}

export async function GET() {
  let markets: number | null = null;
  let signals: number | null = null;
  let filterSignals: number | null = null;
  let roi: number | null = null;
  let primary: DivergenceSignal | null = null;

  // Hard 2.5s timeout per fetch — Twitter / Discord / Slack OG bots
  // typically time out at 5-10s. /api/methodology/stats can be slow on
  // a cold cache; without this guard, /og hangs and the share preview
  // breaks silently. AbortSignal.timeout requires Node 18+.
  try {
    const [scanRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/api/scan/latest`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      }),
      fetch(`${API_BASE}/api/methodology/stats`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      }),
    ]);

    if (scanRes.ok) {
      const scan = await scanRes.json();
      const visibleMarkets = new Set(
        (scan.divergences || []).map(
          (signal: DivergenceSignal) => signal.market_id || signal.question,
        ),
      ).size;
      // `??` not `||` so a legitimate 0 doesn't get masked as "--".
      const reported =
        typeof scan.total_markets === "number" && scan.total_markets > 0
          ? scan.total_markets
          : visibleMarkets;
      markets = reported ?? null;
      signals = scan.total_divergences ?? null;
      primary = scan.divergences?.[0] ?? null;
    }

    if (statsRes.ok) {
      const stats = await statsRes.json();
      filterSignals = stats.predictive_filter?.signals ?? null;
      roi = stats.predictive_filter?.roi_pct ?? null;
    }
  } catch {
    // Timeout, network failure, or malformed JSON. Render the card
    // with whatever we have — empty state is still a valid preview.
  }

  // Defensive null-guard each primary field. The DivergenceSignal
  // interface declares them required, but the API contract is the
  // only thing keeping that promise; a malformed payload would
  // otherwise render NaN% or "undefined".
  const hasPrimary =
    primary != null &&
    typeof primary.market_price === "number" &&
    typeof primary.sm_consensus === "number" &&
    typeof primary.divergence_pct === "number";

  const roiText = roi == null ? "--" : `${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`;
  const crowd = hasPrimary ? pct(primary!.market_price) : "--";
  const scope = hasPrimary
    ? `${primary!.sm_direction || "?"} ${pct(primary!.sm_consensus)}`
    : "--";
  const divergence = hasPrimary
    ? `${Math.round(primary!.divergence_pct * 100)}%`
    : "--";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#f5faf7",
          color: "#111827",
          fontFamily: "sans-serif",
          padding: 56,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(17,24,39,0.08) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -70,
            top: -70,
            width: 360,
            height: 360,
            borderRadius: 999,
            border: "1px solid rgba(13,197,132,0.35)",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "54%",
          height: "100%",
          position: "relative",
        }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                border: "1px solid rgba(13,197,132,0.55)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0dc584",
                fontSize: 18,
              }}
            >
              +
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.4 }}>
              PolyScope
            </div>
            <div
              style={{
                fontSize: 12,
                letterSpacing: 2,
                color: "#0a8f63",
                border: "1px solid rgba(13,197,132,0.4)",
                borderRadius: 4,
                padding: "4px 8px",
              }}
            >
              SCOPE VIEW
            </div>
          </div>

          <div
            style={{
              fontSize: 58,
              lineHeight: 0.96,
              fontWeight: 700,
              letterSpacing: -2.2,
              marginTop: 62,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span>Polymarket traders,</span>
            <span>ranked by</span>
            <span>
              <span style={{ color: "#0dc584" }}>accuracy,</span>{" "}
              <span style={{ color: "#6b7280" }}>not profit.</span>
            </span>
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              gap: 14,
            }}
          >
            <Metric label="MARKETS" value={num(markets)} />
            <Metric label="SIGNALS" value={num(signals)} />
            <Metric label="FILTER" value={num(filterSignals)} />
            <Metric label="ROI" value={roiText} accent />
          </div>
        </div>

        <div
          style={{
            position: "relative",
            marginLeft: 42,
            flex: 1,
            border: "1px solid rgba(17,24,39,0.16)",
            borderRadius: 12,
            background: "rgba(255,255,255,0.68)",
            padding: 28,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 20px 70px rgba(17,24,39,0.13)",
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: 2, color: "#64748b" }}>
            CONSENSUS RIFT MONITOR
          </div>
          <div
            style={{
              marginTop: 18,
              border: "1px solid rgba(13,197,132,0.32)",
              borderRadius: 10,
              background: "rgba(13,197,132,0.07)",
              padding: 22,
              display: "flex",
              flexDirection: "column",
              minHeight: 250,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ fontSize: 12, letterSpacing: 2, color: "#64748b" }}>
                  LARGEST LIVE RIFT
                </div>
                <div
                  style={{
                    marginTop: 14,
                    fontSize: 29,
                    lineHeight: 1.15,
                    fontWeight: 650,
                    color: "#1f2937",
                  }}
                >
                  {primary?.question || "Live divergence tape loading"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div
                  style={{
                    fontSize: 66,
                    lineHeight: 0.9,
                    fontWeight: 750,
                    letterSpacing: -2,
                    color: "#ff9f1c",
                  }}
                >
                  {divergence}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
                  divergence
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: "auto",
                display: "flex",
                gap: 12,
              }}
            >
              <Mini label="CROWD" value={crowd} />
              <Mini label="POLYSCOPE" value={scope} accent />
              <Mini
                label="TRADERS"
                value={
                  hasPrimary && typeof primary!.sm_trader_count === "number"
                    ? String(primary!.sm_trader_count)
                    : "--"
                }
              />
            </div>
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 7,
              color: "#64748b",
              fontSize: 17,
              lineHeight: 1.18,
            }}
          >
            <span>polyscope.gudman.xyz</span>
            <span>non-custodial Polymarket intelligence</span>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // Twitter / Slack / Discord OG bots respect this. 5-min CDN
        // cache + 60s browser cache + serve stale up to 1h while
        // revalidating in the background. Underlying numbers only
        // refresh on the 5-min divergence-scan cycle anyway.
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        width: 122,
        border: "1px solid rgba(17,24,39,0.14)",
        borderRadius: 8,
        background: "rgba(255,255,255,0.72)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 2, color: "#64748b" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 29,
          fontWeight: 650,
          color: accent ? "#0dc584" : "#111827",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        border: "1px solid rgba(17,24,39,0.12)",
        borderRadius: 8,
        background: "rgba(255,255,255,0.62)",
        padding: 13,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 2, color: "#64748b" }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 23,
          fontWeight: 650,
          color: accent ? "#0dc584" : "#111827",
        }}
      >
        {value}
      </div>
    </div>
  );
}
