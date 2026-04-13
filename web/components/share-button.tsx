"use client";

import { useState } from "react";
import { trackEvent } from "@/lib/analytics";

const SITE = "https://polyscope.gudman.xyz";

export function ShareButton({
  marketId,
  question,
  direction,
  divergencePct,
}: {
  marketId: string;
  question: string;
  direction: string;
  divergencePct: number;
}) {
  const [copied, setCopied] = useState(false);

  const marketUrl = `${SITE}/market/${marketId}`;
  const divPct = Math.round(divergencePct * 100);
  const shortQuestion =
    question.length > 100 ? question.slice(0, 97) + "…" : question;

  const tweetText = `${shortQuestion}\n\nCrowd vs PolyScope — ${divPct}% divergence. PolyScope fades SM consensus: ${direction}.\n\n`;
  const tweetIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(marketUrl)}`;

  const tweet = () => {
    trackEvent("share_clicked", {
      market_id: marketId,
      channel: "twitter",
    });
    window.open(tweetIntent, "_blank", "noopener,noreferrer");
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(marketUrl);
      setCopied(true);
      trackEvent("share_clicked", {
        market_id: marketId,
        channel: "copy",
      });
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={tweet}
        className="text-xs px-2.5 py-1 bg-gray-800 text-gray-300 border border-gray-700 rounded-md hover:bg-gray-700"
        title="Share on X"
      >
        Share
      </button>
      <button
        onClick={copyLink}
        className="text-xs px-2 py-1 bg-gray-800 text-gray-300 border border-gray-700 rounded-md hover:bg-gray-700"
        title="Copy link"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );
}
