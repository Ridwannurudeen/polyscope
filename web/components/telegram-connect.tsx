"use client";

import { useState } from "react";
import { getClientId } from "@/lib/client-id";
import { useIdentity } from "@/lib/identity";

const BOT_URL = "https://t.me/polyscoppe_bot";

export function TelegramConnect() {
  const { walletAddress } = useIdentity();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const clientId = typeof window !== "undefined" ? getClientId() : "";
  const token = walletAddress || clientId;
  const kind = walletAddress ? "wallet" : "client ID";

  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section className="mb-6 bg-gray-900 border border-gray-800 rounded-xl">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-800/40"
      >
        <div>
          <p className="text-white text-sm font-medium">
            Telegram DMs for follow-trader alerts
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Get instant DMs when a trader you follow takes a new divergent
            position.
          </p>
        </div>
        <span className="text-xs text-gray-500">{open ? "Hide" : "Set up"}</span>
      </button>
      {open && (
        <div className="border-t border-gray-800 p-4 space-y-3">
          <ol className="list-decimal list-inside text-sm text-gray-300 space-y-2">
            <li>
              Open the bot:{" "}
              <a
                href={BOT_URL}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline"
              >
                @polyscoppe_bot
              </a>
            </li>
            <li>
              Send <code className="text-emerald-300">/connect {token}</code>
              <div className="flex items-center gap-2 mt-1.5">
                <code className="text-xs text-gray-400 bg-gray-950 border border-gray-800 rounded px-2 py-1 truncate flex-1">
                  /connect {token}
                </code>
                <button
                  onClick={() => copy("cmd", `/connect ${token}`)}
                  className="text-xs px-2 py-1 bg-gray-800 border border-gray-700 text-gray-200 rounded hover:bg-gray-700"
                >
                  {copied === "cmd" ? "✓ Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                This sends your {kind} to the bot so it knows which alerts to
                DM you.
              </p>
            </li>
            <li>
              Follow a trader on the{" "}
              <a href="/traders" className="text-emerald-400 hover:underline">
                traders page
              </a>
              . DMs start on their next divergent move.
            </li>
          </ol>
          <p className="text-[11px] text-gray-500">
            Send <code>/disconnect</code> to the bot anytime to stop DMs.
          </p>
        </div>
      )}
    </section>
  );
}
