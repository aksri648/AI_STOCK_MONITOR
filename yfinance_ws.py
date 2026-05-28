#!/usr/bin/env python3
"""
yfinance WebSocket service for NSE indices + stocks.
Streams real-time price data via yfinance AsyncWebSocket and serves it
over a local WebSocket server for the Node.js backend to consume.
"""

import asyncio
import json
import logging
import signal
import time

import websockets
import yfinance as yf

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("yf-ws")
# Render probes internal ports with HEAD requests; websockets rejects them at
# the HTTP parse stage before process_request runs. Silence the noise.
logging.getLogger("websockets").setLevel(logging.CRITICAL)

# ── NSE indices → Yahoo Finance tickers ──────────────────────────
NSE_INDEX_MAP = {
    "^NSEI":      "NIFTY 50",
    "^NSEBANK":   "NIFTY BANK",
    "^CNXIT":     "NIFTY IT",
    "^CNXAUTO":   "NIFTY AUTO",
    "^CNXPHARMA": "NIFTY PHARMA",
    "^CNXFMCG":   "NIFTY FMCG",
    "^CNXMETAL":  "NIFTY METAL",
    "^CNXENERGY": "NIFTY ENERGY",
    "^CNXREALTY": "NIFTY REALTY",
    "^CNXMEDIA":  "NIFTY MEDIA",
}

# ── NSE stocks → Yahoo Finance tickers (.NS suffix) ──────────────
NSE_STOCK_MAP = {
    "RELIANCE.NS":  "RELIANCE",
    "TCS.NS":       "TCS",
    "HDFCBANK.NS":  "HDFCBANK",
    "INFY.NS":      "INFY",
    "ICICIBANK.NS": "ICICIBANK",
    "HINDUNILVR.NS":"HINDUNILVR",
    "SBIN.NS":      "SBIN",
    "BHARTIARTL.NS":"BHARTIARTL",
    "ITC.NS":       "ITC",
    "WIPRO.NS":     "WIPRO",
}

INDEX_TICKERS = list(NSE_INDEX_MAP.keys())
STOCK_TICKERS = list(NSE_STOCK_MAP.keys())
ALL_TICKERS   = INDEX_TICKERS + STOCK_TICKERS

WS_SERVER_PORT = 3002


class MarketTracker:
    """Streams NSE indices + stocks via yfinance AsyncWebSocket."""

    def __init__(self):
        self.cached_indices: dict[str, dict] = {}
        self.cached_stocks: dict[str, dict] = {}
        self.connected_clients: set = set()

    # ── data builders ──────────────────────────────────────────────

    def _build_index(self, ticker, price, pct, prev=None, high=None, low=None):
        return {
            "name": NSE_INDEX_MAP.get(ticker, ticker),
            "ticker": ticker,
            "val": round(float(price), 2) if price is not None else None,
            "pct": round(float(pct), 2) if pct is not None else None,
            "prevClose": round(float(prev), 2) if prev is not None else None,
            "high": round(float(high), 2) if high is not None else None,
            "low": round(float(low), 2) if low is not None else None,
        }

    def _build_stock(self, ticker, price, change, pct, high=None, low=None, name=None):
        sym = NSE_STOCK_MAP.get(ticker, ticker.replace(".NS", ""))
        return {
            "symbol": sym,
            "name": name or sym,
            "price": round(float(price), 2) if price is not None else None,
            "change": round(float(change), 2) if change is not None else None,
            "pct": round(float(pct), 2) if pct is not None else None,
            "high": round(float(high), 2) if high is not None else None,
            "low": round(float(low), 2) if low is not None else None,
            "exchange": "NSE",
        }

    # ── WebSocket message handler ──────────────────────────────────

    def _handle_ws_message(self, msg: dict):
        try:
            ticker = msg.get("id", "")
            price = msg.get("price")
            if price is None:
                return

            change_pct = msg.get("changePercent")
            change_abs = msg.get("change")
            prev_close = msg.get("regularMarketPreviousClose") or msg.get("prevClose")
            day_high = msg.get("dayHigh") or msg.get("regularMarketDayHigh")
            day_low = msg.get("dayLow") or msg.get("regularMarketDayLow")

            if ticker in NSE_INDEX_MAP:
                self.cached_indices[ticker] = self._build_index(
                    ticker, price, change_pct, prev_close, day_high, day_low,
                )
                log.info(f"IDX  {NSE_INDEX_MAP[ticker]:>12} = {price:>10} ({change_pct}%)")

            elif ticker in NSE_STOCK_MAP:
                if change_abs is None and prev_close is not None:
                    change_abs = float(price) - float(prev_close)
                if change_pct is None and prev_close is not None and float(prev_close) != 0:
                    change_pct = ((float(price) - float(prev_close)) / float(prev_close)) * 100

                self.cached_stocks[ticker] = self._build_stock(
                    ticker, price, change_abs, change_pct, day_high, day_low,
                )
                log.info(f"STK  {NSE_STOCK_MAP[ticker]:>12} = {price:>10} ({change_pct}%)")

            else:
                return

            asyncio.create_task(self._broadcast_clients())
        except Exception as e:
            log.warning(f"Error parsing WS message: {e}")

    # ── WebSocket streaming (with auto-reconnect) ───────────────────

    async def _stream(self):
        while True:
            try:
                log.info("Connecting to Yahoo Finance WebSocket...")
                ws = yf.AsyncWebSocket(verbose=False)
                await ws.subscribe(ALL_TICKERS)
                log.info(f"Subscribed to {len(ALL_TICKERS)} tickers")
                self._broadcast_to_all()
                await ws.listen(message_handler=self._handle_ws_message)
            except Exception as e:
                log.warning(f"WebSocket error: {e}")
            log.info("WebSocket disconnected, reconnecting in 5s...")
            await asyncio.sleep(5)

    # ── Seed initial data (one-shot, no continuous polling) ────────

    async def _seed(self):
        """Fetch current data once on startup so the frontend has something to show."""
        log.info("Seeding initial data...")
        for ticker in ALL_TICKERS:
            try:
                t = yf.Ticker(ticker)
                info = t.fast_info
                price = getattr(info, "last_price", None)
                prev = getattr(info, "previous_close", None)
                day_high = getattr(info, "day_high", None)
                day_low = getattr(info, "day_low", None)

                if price is None:
                    hist = t.history(period="1d")
                    if not hist.empty:
                        price = float(hist["Close"].iloc[-1])

                pct = None
                change = None
                if price is not None and prev is not None and prev != 0:
                    change = price - prev
                    pct = (change / prev) * 100

                if ticker in NSE_INDEX_MAP:
                    self.cached_indices[ticker] = self._build_index(
                        ticker, price, pct, prev, day_high, day_low,
                    )
                elif ticker in NSE_STOCK_MAP:
                    self.cached_stocks[ticker] = self._build_stock(
                        ticker, price, change, pct, day_high, day_low,
                    )
            except Exception as e:
                log.warning(f"Seed failed for {ticker}: {e}")

        log.info(f"Seeded {len(self.cached_indices)} indices, {len(self.cached_stocks)} stocks")
        self._broadcast_to_all()

    # ── Broadcasting ───────────────────────────────────────────────

    def _broadcast_to_all(self):
        if not self.connected_clients:
            return
        payload = json.dumps({
            "type": "market",
            "indices": list(self.cached_indices.values()),
            "stocks": list(self.cached_stocks.values()),
            "source": "yfinance-ws",
            "ts": int(time.time() * 1000),
        })
        dead = set()
        for ws in self.connected_clients:
            try:
                asyncio.create_task(ws.send(payload))
            except Exception:
                dead.add(ws)
        self.connected_clients -= dead

    async def _broadcast_clients(self):
        self._broadcast_to_all()

    # ── Client handling (Node.js connects here) ────────────────────

    async def _handle_client(self, ws):
        self.connected_clients.add(ws)
        log.info(f"Client connected ({len(self.connected_clients)} total)")

        if self.cached_indices or self.cached_stocks:
            try:
                await ws.send(json.dumps({
                    "type": "market",
                    "indices": list(self.cached_indices.values()),
                    "stocks": list(self.cached_stocks.values()),
                    "source": "yfinance-ws",
                    "ts": int(time.time() * 1000),
                }))
            except Exception:
                pass

        try:
            async for _ in ws:
                pass
        except Exception:
            pass
        finally:
            self.connected_clients.discard(ws)
            log.info(f"Client disconnected ({len(self.connected_clients)} total)")

    # ── Main entry ─────────────────────────────────────────────────

    async def run(self):
        log.info(f"Starting yfinance market service on ws://localhost:{WS_SERVER_PORT}")
        log.info(f"Tracking {len(INDEX_TICKERS)} indices + {len(STOCK_TICKERS)} stocks")

        server = await websockets.serve(
            self._handle_client, "localhost", WS_SERVER_PORT,
        )
        log.info("WebSocket server ready")

        tasks = [
            asyncio.create_task(self._seed()),
            asyncio.create_task(self._stream()),
        ]

        stop = asyncio.Event()

        def _on_signal():
            log.info("Shutdown signal received")
            stop.set()

        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _on_signal)

        await stop.wait()
        for t in tasks:
            t.cancel()
        server.close()
        await server.wait_closed()
        log.info("Service stopped")


async def main():
    tracker = MarketTracker()
    await tracker.run()


if __name__ == "__main__":
    asyncio.run(main())
