"""Polymarket API client — Gamma, Data, and CLOB APIs."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from polyscope.models import Market, Position, Trade, Trader

logger = logging.getLogger(__name__)

GAMMA_BASE = "https://gamma-api.polymarket.com"
DATA_BASE = "https://data-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"

# Timeout for all API calls
TIMEOUT = httpx.Timeout(15.0, connect=5.0)


class PolymarketClient:
    def __init__(self, http_client: httpx.AsyncClient | None = None):
        self._client = http_client or httpx.AsyncClient(timeout=TIMEOUT)
        self._owns_client = http_client is None

    async def close(self):
        if self._owns_client:
            await self._client.aclose()

    # ── Gamma API ──────────────────────────────────────────────

    async def get_markets(
        self, limit: int = 100, offset: int = 0, active: bool = True
    ) -> list[Market]:
        """Fetch active markets from Gamma API."""
        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "active": str(active).lower(),
            "closed": "false",
            "order": "volume24hr",
            "ascending": "false",
        }
        data = await self._get(f"{GAMMA_BASE}/markets", params)
        if not isinstance(data, list):
            return []
        return [self._parse_market(m) for m in data]

    async def get_market(self, condition_id: str) -> Market | None:
        data = await self._get(f"{GAMMA_BASE}/markets/{condition_id}")
        if not data:
            return None
        return self._parse_market(data)

    async def search_markets(self, query: str, limit: int = 20) -> list[Market]:
        params = {"q": query, "limit_per_type": limit}
        data = await self._get(f"{GAMMA_BASE}/public-search", params)
        if not isinstance(data, dict):
            return []
        markets_raw = data.get("markets", [])
        return [self._parse_market(m) for m in markets_raw]

    async def get_events(
        self, limit: int = 50, offset: int = 0, active: bool = True
    ) -> list[dict]:
        params = {
            "limit": limit,
            "offset": offset,
            "active": str(active).lower(),
            "closed": "false",
        }
        return await self._get(f"{GAMMA_BASE}/events", params) or []

    async def get_closed_markets(
        self, limit: int = 100, offset: int = 0
    ) -> list[dict]:
        """Fetch closed/resolved markets from Gamma API (raw dicts)."""
        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "active": "false",
            "closed": "true",
            "order": "volume24hr",
            "ascending": "false",
        }
        data = await self._get(f"{GAMMA_BASE}/markets", params)
        if not isinstance(data, list):
            return []
        return data

    @staticmethod
    def determine_outcome(market_raw: dict) -> tuple[int, float] | None:
        """Parse outcome from a closed Gamma API market.

        Returns (outcome, final_price) or None if not definitively resolved.
        outcome: 1 = YES won, 0 = NO won.
        """
        import json as _json

        prices_raw = market_raw.get("outcomePrices", [])
        if isinstance(prices_raw, str):
            try:
                prices_raw = _json.loads(prices_raw)
            except (ValueError, _json.JSONDecodeError):
                return None

        if not isinstance(prices_raw, list) or len(prices_raw) < 2:
            return None

        try:
            p_yes = float(prices_raw[0])
            p_no = float(prices_raw[1])
        except (TypeError, ValueError):
            return None

        if p_yes >= 0.99:
            return (1, p_yes)
        if p_no >= 0.99:
            return (0, 1.0 - p_no)
        return None

    # ── Data API ───────────────────────────────────────────────

    async def get_leaderboard(
        self, limit: int = 100, time_period: str = "all"
    ) -> list[Trader]:
        """Fetch top traders from leaderboard."""
        params = {"limit": limit, "timePeriod": time_period}
        data = await self._get(f"{DATA_BASE}/v1/leaderboard", params)
        if not isinstance(data, list):
            return []
        traders = []
        for i, t in enumerate(data):
            profit = self._float(t.get("pnl", t.get("profit", 0)))
            volume = self._float(t.get("vol", t.get("volume", 0)))
            traders.append(
                Trader(
                    address=t.get("proxyWallet", t.get("userAddress", t.get("address", ""))),
                    rank=int(t.get("rank", i + 1)),
                    profit=profit,
                    volume=volume,
                    markets_traded=int(t.get("marketsTraded", t.get("numMarkets", 0))),
                    name=t.get("userName", t.get("displayName", "")),
                    alpha_ratio=profit / max(volume, 1),
                )
            )
        return traders

    async def get_positions(self, user: str, limit: int = 100) -> list[Position]:
        """Fetch positions for a specific user address."""
        params = {"user": user, "limit": limit, "sortBy": "value"}
        data = await self._get(f"{DATA_BASE}/positions", params)
        if not isinstance(data, list):
            return []
        positions = []
        for p in data:
            market_id = p.get("market", p.get("conditionId", p.get("asset", "")))
            size = self._float(p.get("size", p.get("amount", 0)))
            if size <= 0:
                continue
            side = self._infer_side(p)
            positions.append(
                Position(
                    trader_address=user,
                    market_id=market_id,
                    side=side,
                    size=size,
                    avg_price=self._float(p.get("avgPrice", 0)),
                    pnl=self._float(p.get("pnl", p.get("currentPnl", 0))),
                )
            )
        return positions

    async def get_market_positions(
        self, market: str, limit: int = 100
    ) -> list[Position]:
        """Fetch all positions for a specific market (v1 endpoint).

        Response format: [{token: str, positions: [{proxyWallet, size, outcome, ...}]}]
        """
        params = {"market": market, "limit": limit}
        data = await self._get(f"{DATA_BASE}/v1/market-positions", params)
        if not isinstance(data, list):
            return []

        # Response is nested: list of token groups, each with positions
        positions = []
        for token_group in data:
            if isinstance(token_group, dict) and "positions" in token_group:
                for p in token_group["positions"]:
                    size = self._float(p.get("size", p.get("amount", 0)))
                    if size <= 0:
                        continue
                    positions.append(
                        Position(
                            trader_address=p.get("proxyWallet", p.get("userAddress", "")),
                            market_id=market,
                            side=self._infer_side(p),
                            size=size,
                            avg_price=self._float(p.get("avgPrice", 0)),
                            pnl=self._float(p.get("totalPnl", p.get("pnl", 0))),
                        )
                    )
            elif isinstance(token_group, dict):
                # Flat format fallback
                size = self._float(token_group.get("size", 0))
                if size > 0:
                    positions.append(
                        Position(
                            trader_address=token_group.get("proxyWallet", token_group.get("userAddress", "")),
                            market_id=market,
                            side=self._infer_side(token_group),
                            size=size,
                            avg_price=self._float(token_group.get("avgPrice", 0)),
                            pnl=self._float(token_group.get("totalPnl", token_group.get("pnl", 0))),
                        )
                    )
        return positions

    async def get_holders(self, market: str, limit: int = 100) -> list[dict]:
        params = {"market": market, "limit": limit}
        return await self._get(f"{DATA_BASE}/holders", params) or []

    async def get_trades(
        self, market: str | None = None, user: str | None = None, limit: int = 50
    ) -> list[Trade]:
        """Fetch trades and return parsed Trade objects."""
        params: dict[str, Any] = {"limit": limit}
        if market:
            params["market"] = market
        if user:
            params["user"] = user
        data = await self._get(f"{DATA_BASE}/trades", params)
        if not isinstance(data, list):
            return []
        trades = []
        for t in data:
            trader_addr = t.get("proxyWallet", t.get("maker", t.get("user", "")))
            side_raw = t.get("side", t.get("outcome", ""))
            side = self._infer_side({"outcome": side_raw}) if side_raw else "YES"
            size = self._float(t.get("size", t.get("amount", 0)))
            price = self._float(t.get("price", 0))
            ts = t.get("createdAt", t.get("timestamp", ""))
            market_id = t.get("market", t.get("conditionId", market or ""))
            if size <= 0:
                continue
            trades.append(Trade(
                trader_address=trader_addr,
                market_id=market_id,
                side=side,
                size=size,
                price=price,
                timestamp=ts,
            ))
        return trades

    async def get_sm_recent_trades(
        self, market_id: str, sm_addresses: set[str], hours: int = 48
    ) -> list[Trade]:
        """Fetch recent trades for a market, filtered to SM addresses and time window."""
        from datetime import datetime, timedelta, timezone

        trades = await self.get_trades(market=market_id, limit=200)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        sm_trades = []
        for trade in trades:
            if trade.trader_address not in sm_addresses:
                continue
            try:
                trade_time = datetime.fromisoformat(trade.timestamp.replace("Z", "+00:00"))
                if trade_time < cutoff:
                    continue
            except (ValueError, AttributeError):
                continue
            sm_trades.append(trade)
        return sm_trades

    # ── CLOB API ───────────────────────────────────────────────

    async def get_price(self, token_id: str, side: str = "BUY") -> float:
        params = {"token_id": token_id, "side": side}
        data = await self._get(f"{CLOB_BASE}/price", params)
        if isinstance(data, dict):
            return self._float(data.get("price", 0))
        return 0.0

    async def get_prices(self, token_ids: list[str]) -> dict[str, float]:
        """Batch fetch prices for multiple tokens."""
        if not token_ids:
            return {}
        # Use POST endpoint for batch
        payload = [{"token_id": tid, "side": "BUY"} for tid in token_ids]
        try:
            resp = await self._client.post(f"{CLOB_BASE}/prices", json=payload)
            resp.raise_for_status()
            data = resp.json()
        except Exception:
            logger.exception("Failed batch price fetch")
            return {}
        # Response is a list of {token_id, price}
        result = {}
        if isinstance(data, list):
            for item in data:
                tid = item.get("token_id", "")
                result[tid] = self._float(item.get("price", 0))
        elif isinstance(data, dict):
            for tid, price in data.items():
                result[tid] = self._float(price)
        return result

    async def get_price_history(
        self,
        market: str,
        interval: str = "1d",
        fidelity: int = 60,
        start_ts: int | None = None,
        end_ts: int | None = None,
    ) -> list[dict]:
        params: dict[str, Any] = {
            "market": market,
            "interval": interval,
            "fidelity": fidelity,
        }
        if start_ts:
            params["startTs"] = start_ts
        if end_ts:
            params["endTs"] = end_ts
        data = await self._get(f"{CLOB_BASE}/prices-history", params)
        if isinstance(data, dict):
            return data.get("history", [])
        return data if isinstance(data, list) else []

    async def get_orderbook(self, token_id: str) -> dict:
        params = {"token_id": token_id}
        return await self._get(f"{CLOB_BASE}/book", params) or {}

    async def get_spread(self, token_id: str) -> dict:
        params = {"token_id": token_id}
        return await self._get(f"{CLOB_BASE}/spread", params) or {}

    async def get_simplified_markets(self) -> list[dict]:
        """Fetch all active markets from CLOB with token IDs and pricing."""
        results = []
        cursor = ""
        while True:
            params: dict[str, Any] = {}
            if cursor:
                params["next_cursor"] = cursor
            data = await self._get(f"{CLOB_BASE}/simplified-markets", params)
            if not isinstance(data, dict):
                break
            batch = data.get("data", [])
            results.extend(batch)
            cursor = data.get("next_cursor", "")
            if not cursor or cursor == "LTE=":
                break
        return results

    # ── Helpers ─────────────────────────────────────────────────

    async def _get(self, url: str, params: dict | None = None) -> Any:
        try:
            resp = await self._client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            logger.warning("HTTP %s from %s", e.response.status_code, url)
            return None
        except Exception:
            logger.exception("Request failed: %s", url)
            return None

    @staticmethod
    def _float(val: Any) -> float:
        try:
            return float(val)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _infer_side(p: dict) -> str:
        """Infer YES/NO side from position data."""
        # Check outcome field first (market-positions API uses "Yes"/"No")
        outcome = p.get("outcome", p.get("side", ""))
        if isinstance(outcome, str):
            upper = outcome.upper().strip()
            if upper in ("YES", "LONG", "Y", "1"):
                return "YES"
            if upper in ("NO", "SHORT", "N", "0"):
                return "NO"
        # Some endpoints use token index: 0=YES, 1=NO
        outcome_idx = p.get("outcomeIndex", p.get("tokenIndex", -1))
        if outcome_idx == 0:
            return "YES"
        if outcome_idx == 1:
            return "NO"
        return "YES"  # default assumption

    @staticmethod
    def _parse_market(m: dict) -> Market:
        tokens = m.get("clobTokenIds", m.get("tokens", []))
        token_yes = ""
        token_no = ""
        if isinstance(tokens, list) and len(tokens) >= 2:
            token_yes = tokens[0] if isinstance(tokens[0], str) else str(tokens[0])
            token_no = tokens[1] if isinstance(tokens[1], str) else str(tokens[1])
        elif isinstance(tokens, str):
            # Sometimes comma-separated
            parts = tokens.split(",")
            if len(parts) >= 2:
                token_yes, token_no = parts[0].strip(), parts[1].strip()

        outcomes_prices = m.get("outcomePrices", m.get("bestAsk", []))
        price_yes = 0.0
        price_no = 0.0
        if isinstance(outcomes_prices, list) and len(outcomes_prices) >= 2:
            price_yes = float(outcomes_prices[0]) if outcomes_prices[0] else 0.0
            price_no = float(outcomes_prices[1]) if outcomes_prices[1] else 0.0
        elif isinstance(outcomes_prices, str):
            # "[\"0.65\",\"0.35\"]" format
            import json

            try:
                parsed = json.loads(outcomes_prices)
                if len(parsed) >= 2:
                    price_yes = float(parsed[0])
                    price_no = float(parsed[1])
            except (json.JSONDecodeError, ValueError):
                pass

        tags_raw = m.get("tags", [])
        category = ""
        if isinstance(tags_raw, list) and tags_raw:
            first = tags_raw[0]
            category = first.get("label", first) if isinstance(first, dict) else str(first)
        elif isinstance(tags_raw, str):
            category = tags_raw

        return Market(
            condition_id=m.get("conditionId", m.get("condition_id", m.get("id", ""))),
            question=m.get("question", m.get("title", "")),
            slug=m.get("slug", ""),
            category=category or m.get("groupItemTitle", m.get("category", "")),
            end_date=m.get("endDate", m.get("end_date_iso", "")),
            active=m.get("active", True),
            closed=m.get("closed", False),
            token_id_yes=token_yes,
            token_id_no=token_no,
            price_yes=price_yes,
            price_no=price_no,
            volume_24h=float(m.get("volume24hr", m.get("volume24h", 0)) or 0),
            open_interest=float(m.get("openInterest", m.get("open_interest", 0)) or 0),
            liquidity=float(m.get("liquidity", 0) or 0),
        )
