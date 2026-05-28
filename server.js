import "dotenv/config"
import express from "express"
import { createServer } from "http"
import { WebSocketServer, WebSocket as WsClient } from "ws"
import { NseIndia } from "stock-nse-india"
import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

const nse = new NseIndia()

const YF_WS_URL = "ws://localhost:3002"
let yfWs = null
let yfReconnectTimer = null
let yfConnectedOnce = false

const NSE_STOCKS = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK",
  "HINDUNILVR", "SBIN", "BHARTIARTL", "ITC", "WIPRO",
]

let cachedIndices = []
let cachedStocks = NSE_STOCKS.map(sym => ({
  symbol: sym, name: sym, price: null, change: null, pct: null,
  high: null, low: null, exchange: "NSE",
}))

function connectYFinance() {
  if (yfWs) return
  yfWs = new WsClient(YF_WS_URL)

  yfWs.on("open", () => {
    yfConnectedOnce = true
    console.log("Connected to yfinance market service")
    if (yfReconnectTimer) { clearTimeout(yfReconnectTimer); yfReconnectTimer = null }
  })

  yfWs.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === "market") {
        if (Array.isArray(msg.indices)) cachedIndices = msg.indices
        if (Array.isArray(msg.stocks))  cachedStocks = msg.stocks
        broadcast({ type: "market", indices: cachedIndices, stocks: cachedStocks, ts: Date.now() })
      }
    } catch {}
  })

  yfWs.on("close", () => {
    yfWs = null
    scheduleYfReconnect()
  })

  yfWs.on("error", (err) => {
    if (yfConnectedOnce) console.error("yfinance WS error:", err.message)
    yfWs = null
    scheduleYfReconnect()
  })
}

function scheduleYfReconnect() {
  if (yfReconnectTimer) return
  const delay = yfConnectedOnce ? 5000 : 3000
  yfReconnectTimer = setTimeout(() => { yfReconnectTimer = null; connectYFinance() }, delay)
}

function broadcast(data) {
  const msg = JSON.stringify(data)
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg)
  })
}

wss.on("connection", (ws) => {
  ws.isAlive = true
  ws.on("pong", () => { ws.isAlive = true })
  if (cachedIndices || cachedStocks) {
    ws.send(JSON.stringify({ type: "market", indices: cachedIndices, stocks: cachedStocks, ts: Date.now() }))
  }
})

const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate()
    ws.isAlive = false
    ws.ping()
  })
}, 30000)

wss.on("close", () => clearInterval(heartbeat))

app.get("/api/indices", (req, res) => {
  if (!cachedIndices) return res.status(503).json({ error: "Loading" })
  res.json(cachedIndices)
})

app.get("/api/indian", (req, res) => {
  if (!cachedStocks) return res.status(503).json({ error: "Loading" })
  res.json(cachedStocks)
})

const AMFI_URL = "https://www.amfiindia.com/spages/NAVAll.txt"
let mfCache = { funds: [], date: "", updated: 0 }
const MF_TTL = 30 * 60 * 1000 // 30 min

async function fetchMFNav() {
  try {
    const r = await fetch(AMFI_URL)
    if (!r.ok) return
    const text = await r.text()
    const lines = text.split("\n").filter(l => l.trim())
    const funds = []
    let latestDate = ""
    for (const line of lines) {
      const parts = line.split(";").length > 1 ? line.split(";") : line.split("|")
      if (parts.length < 5) continue
      const code = parts[0].trim()
      const name = parts[3].trim()
      const nav  = parts[4].trim()
      if (!code || !name || !nav || isNaN(parseFloat(nav))) continue
      if (/^[A-Z\s]{3,}$/.test(name) && name.length < 8) continue // skip headers
      const date = parts[5]?.trim() || ""
      if (date) latestDate = date
      funds.push({ code, name, nav, date })
    }
    if (funds.length > 0) {
      mfCache = { funds, date: latestDate, updated: Date.now() }
      console.log(`MF NAV cached: ${funds.length} funds`)
    }
  } catch (e) { console.error("MF NAV fetch failed:", e.message) }
}

fetchMFNav()

app.get("/api/mfnav", (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim()
  const limit = parseInt(req.query.limit) || 30
  const now = Date.now()
  if (now - mfCache.updated > MF_TTL) {
    fetchMFNav().then(() => respond())
  } else {
    respond()
  }
  function respond() {
    if (mfCache.funds.length === 0) {
      return res.json({ funds: [], date: "", error: "MF data not available yet, retrying..." })
    }
    if (!q || q.length < 1) {
      return res.json({ funds: [], date: mfCache.date })
    }
    const filtered = mfCache.funds
      .filter(f => f.name.toLowerCase().includes(q))
      .slice(0, limit)
    res.json({ funds: filtered, date: mfCache.date })
  }
})

app.get("/api/insights", async (req, res) => {
  const symbol = (req.query.symbol || "").toUpperCase().trim()
  if (!symbol) return res.json({ error: "Missing symbol" })
  try {
    const [indicators, tradeInfo, equity, historical] = await Promise.all([
      nse.getTechnicalIndicators(symbol).catch(() => null),
      nse.getEquityTradeInfo(symbol).catch(() => null),
      nse.getEquityDetails(symbol).catch(() => null),
      nse.getEquityHistoricalData(symbol).catch(() => null),
    ])
    if (!indicators && !tradeInfo && !equity) {
      return res.json({ error: "No data available for " + symbol })
    }

    const pi = equity?.priceInfo || {}
    const currentPrice = parseFloat(pi.lastPrice) || 0
    const prevClose = parseFloat(pi.previousClose) || currentPrice
    const change = parseFloat(pi.change) || 0
    const pct = parseFloat(pi.pChange) || 0

    const rsiArr = indicators?.rsi || []
    const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : null
    const macd = indicators?.macd || {}
    const macdLine = macd.macd?.length > 0 ? macd.macd[macd.macd.length - 1] : 0
    const macdSignal = macd.signal?.length > 0 ? macd.signal[macd.signal.length - 1] : 0
    const macdHist = macd.histogram?.length > 0 ? macd.histogram[macd.histogram.length - 1] : 0

    const sma = indicators?.sma || {}
    const sma5 = sma.sma5?.length > 0 ? sma.sma5[sma.sma5.length - 1] : null
    const sma20 = sma.sma20?.length > 0 ? sma.sma20[sma.sma20.length - 1] : null
    const sma50 = sma.sma50?.length > 0 ? sma.sma50[sma.sma50.length - 1] : null
    const sma200 = sma.sma200?.length > 0 ? sma.sma200[sma.sma200.length - 1] : null

    const adxArr = indicators?.adx || []
    const adx = adxArr.length > 0 ? adxArr[adxArr.length - 1] : 0
    const mfiArr = indicators?.mfi || []
    const mfi = mfiArr.length > 0 ? mfiArr[mfiArr.length - 1] : null

    const bb = indicators?.bollingerBands || {}
    const bbUpper = bb.upper?.length > 0 ? bb.upper[bb.upper.length - 1] : null
    const bbLower = bb.lower?.length > 0 ? bb.lower[bb.lower.length - 1] : null

    const obvArr = indicators?.obv || []
    const obv = obvArr.length > 0 ? obvArr[obvArr.length - 1] : 0
    const obvPrev = obvArr.length > 1 ? obvArr[obvArr.length - 2] : obv
    const atrArr = indicators?.atr || []
    const atr = atrArr.length > 0 ? atrArr[atrArr.length - 1] : 0

    const tradeVol = tradeInfo?.marketDeptOrderBook?.tradeInfo?.totalTradedVolume || 0
    const tradeVal = tradeInfo?.marketDeptOrderBook?.tradeInfo?.totalTradedValue || 0
    const deliveryQty = tradeInfo?.securityWiseDP?.deliveryQuantity || 0
    const deliveryPct = tradeInfo?.securityWiseDP?.deliveryToTradedQuantity || 0

    // Build historical chart data (last 60 trading days)
    const histData = historical?.flatMap(x => x.data) || []
    const chartData = histData.slice(-60).map(d => ({
      date: d.mtimestamp,
      open: parseFloat(d.chOpeningPrice) || 0,
      high: parseFloat(d.chTradeHighPrice) || 0,
      low: parseFloat(d.chTradeLowPrice) || 0,
      close: parseFloat(d.chClosingPrice) || 0,
      volume: parseInt(d.chTotTradedQty) || 0,
      vwap: parseFloat(d.vwap || 0) || 0,
    }))

    // Order book depth
    const bid = tradeInfo?.marketDeptOrderBook?.bid || []
    const ask = tradeInfo?.marketDeptOrderBook?.ask || []
    const depthData = {
      maxBidQty: Math.max(...bid.map(b => b.quantity || 0), 1),
      maxAskQty: Math.max(...ask.map(a => a.quantity || 0), 1),
      bids: bid.slice(0, 5),
      asks: ask.slice(0, 5),
    }

    const dataPayload = {
      symbol, price: currentPrice, change: { value: change, pct },
      previousClose: prevClose,
      indicators: {
        rsi, macd: { macdLine, signal: macdSignal, histogram: macdHist },
        sma: { sma5, sma20, sma50, sma200 }, adx, mfi,
        bollinger: { upper: bbUpper, lower: bbLower },
        obv: { current: obv, previous: obvPrev }, atr,
      },
      trade: { volume: tradeVol, value: tradeVal, deliveryQty, deliveryPct },
      chartData: chartData.slice(-30).map(d => ({ date: d.date, close: d.close, volume: d.volume })),
    }

    // Try AI analysis via Groq; fallback to rule-based
    try {
      if (!process.env.GROQ_API_KEY) throw new Error("No API key")
      const rules = `TECHNICAL ANALYSIS RULES:

1. RSI (Relative Strength Index):
   - < 30: Oversold — bullish signal, potential bounce
   - 30-44: Approaching oversold — mildly bullish
   - 45-55: Neutral range
   - 56-69: Approaching overbought — mildly bearish
   - > 70: Overbought — bearish signal, potential reversal

2. MACD (Moving Average Convergence Divergence):
   - Line > Signal + histogram positive: Strong bullish momentum
   - Line > Signal but histogram shrinking: Bullish but weakening
   - Line < Signal + histogram negative: Strong bearish momentum
   - Line < Signal but histogram improving: Bearish but weakening
   - Histogram crossing from negative to positive: Potential buy signal
   - Histogram crossing from positive to negative: Potential sell signal

3. SMA (Simple Moving Average) Crossovers:
   - Price above SMA(5): Short-term momentum up
   - Price below SMA(5): Short-term momentum down
   - Price above SMA(20): Medium-term trend up
   - Price below SMA(20): Medium-term trend down
   - Price above SMA(50): Longer-term trend up
   - Price below SMA(50): Longer-term trend down
   - Price above SMA(200): Secular bull trend
   - Price below SMA(200): Secular bear trend
   - Golden cross (SMA50 crossing above SMA200): Major bullish signal
   - Death cross (SMA50 crossing below SMA200): Major bearish signal

4. ADX (Average Directional Index):
   - < 20: Weak trend, choppy/market in range
   - 20-25: Trend developing
   - 25-40: Strong trend
   - > 40: Very strong trend (may be overextended)

5. MFI (Money Flow Index) — volume-weighted RSI:
   - < 20: Oversold with volume confirmation — strong bullish
   - 20-30: Mildly oversold
   - > 80: Overbought with volume confirmation — strong bearish
   - 70-80: Mildly overbought

6. Bollinger Bands:
   - Price touching/above upper band: Overextended, potential pullback
   - Price touching/below lower band: Oversold, potential bounce
   - Narrow bands (squeeze): Low volatility, breakout imminent
   - Wide bands: High volatility

7. OBV (On-Balance Volume) Divergence:
   - OBV rising with price: Volume confirms uptrend — bullish
   - OBV falling with price: Volume confirms downtrend — bearish
   - OBV rising while price falling: Hidden accumulation — bullish divergence
   - OBV falling while price rising: Distribution — bearish divergence

8. Volume / Delivery Analysis:
   - High delivery % (>50%): Strong hands accumulating — bullish
   - Low delivery % (<20%): Speculative trading — less conviction
   - Rising volume on up days: Strong buying interest
   - Rising volume on down days: Strong selling pressure`

      const completion = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: `You are a professional equity research analyst specializing in Indian NSE stocks.
Analyze the provided NSE stock data using the technical analysis rules below.

${rules}

Return ONLY valid JSON with this exact structure:
{
  "score": <number 0-100>,
  "verdict": <"STRONG BUY"|"BUY"|"HOLD"|"CAUTION"|"STRONG SELL">,
  "verdictColor": <hex color matching verdict>,
  "signals": [{"type": "bullish"|"bearish"|"neutral", "text": "<brief signal under 120 chars>"}],
  "summary": "<2-3 sentence actionable analysis>"
}
Score: 70+ STRONG BUY (#00e676), 55-69 BUY (#4caf50), 45-54 HOLD (#f5a623), 30-44 CAUTION (#ff9800), <30 STRONG SELL (#ff3c5c).
Weight RSI(25%), MACD(20%), SMA position(25%), ADX(10%), MFI(10%), Bollinger(5%), OBV divergence(5%).
Keep signals concise (under 120 chars). Limit to 6-8 signals. Be objective.`
          },
          { role: "user", content: `NSE Stock Analysis Request\n\nSymbol: ${dataPayload.symbol}\nPrice: ₹${dataPayload.price} (${dataPayload.change.pct >= 0 ? '+' : ''}${dataPayload.change.pct}%)\nPrevious Close: ₹${dataPayload.previousClose}\n\nTechnical Indicators:\n${JSON.stringify(dataPayload.indicators, null, 2)}\n\nTrade Data:\n${JSON.stringify(dataPayload.trade, null, 2)}` }
        ],
        temperature: 0.1,
        max_tokens: 1024,
      })

      const text = completion.choices?.[0]?.message?.content || ""
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const ai = JSON.parse(jsonMatch[0])
        return res.json({
          symbol, ai: true,
          score: ai.score ?? 50,
          verdict: ai.verdict ?? "HOLD",
          verdictColor: ai.verdictColor ?? "#f5a623",
          price: currentPrice,
          change: { value: change, pct },
          indicators: {
            rsi: rsi != null ? Math.round(rsi * 10) / 10 : null,
            macd: { value: Math.round(macdLine * 100) / 100, signal: Math.round(macdSignal * 100) / 100, histogram: Math.round(macdHist * 100) / 100 },
            sma: { sma5: sma5 ? Math.round(sma5 * 100) / 100 : null, sma20: sma20 ? Math.round(sma20 * 100) / 100 : null, sma50: sma50 ? Math.round(sma50 * 100) / 100 : null, sma200: sma200 ? Math.round(sma200 * 100) / 100 : null },
            adx: Math.round(adx * 10) / 10, mfi: mfi != null ? Math.round(mfi * 10) / 10 : null,
            atr: Math.round(atr * 100) / 100,
          },
          trade: { volume: tradeVol, value: tradeVal, deliveryQty, deliveryPct },
          signals: (ai.signals || []).slice(0, 8),
          summary: ai.summary || "Analysis completed.",
          chartData: chartData,
          depthData: depthData,
        })
      }
    } catch (e) {
      console.error("Groq AI failed, using rule-based fallback:", e.message)
    }

    // Rule-based fallback
    let score = 50; const signals = []
    if (rsi != null) {
      if (rsi < 30) { score += 20; signals.push({ type: "bullish", text: `RSI ${rsi.toFixed(1)} — oversold, potential bounce` }) }
      else if (rsi < 45) { score += 10; signals.push({ type: "bullish", text: `RSI ${rsi.toFixed(1)} — approaching oversold` }) }
      else if (rsi > 70) { score -= 20; signals.push({ type: "bearish", text: `RSI ${rsi.toFixed(1)} — overbought, caution` }) }
      else if (rsi > 55) { score -= 10; signals.push({ type: "bearish", text: `RSI ${rsi.toFixed(1)} — approaching overbought` }) }
      else { signals.push({ type: "neutral", text: `RSI ${rsi.toFixed(1)} — neutral range` }) }
    }
    if (macdLine != null && macdSignal != null) {
      if (macdLine > macdSignal && macdHist > 0) { score += 15; signals.push({ type: "bullish", text: "MACD bullish — above signal line with positive momentum" }) }
      else if (macdLine < macdSignal && macdHist < 0) { score -= 15; signals.push({ type: "bearish", text: "MACD bearish — below signal line with negative momentum" }) }
      else if (macdLine > macdSignal) { score += 8; signals.push({ type: "bullish", text: "MACD above signal line" }) }
      else if (macdLine < macdSignal) { score -= 8; signals.push({ type: "bearish", text: "MACD below signal line" }) }
    }
    const smaChecks = [sma5, sma20, sma50, sma200]; const smaLabels = ["SMA(5)", "SMA(20)", "SMA(50)", "SMA(200)"]
    let smaBullish = 0; let smaTotal = 0
    for (let i = 0; i < smaChecks.length; i++) {
      if (smaChecks[i] != null && currentPrice > 0) {
        smaTotal++; const smaPct = ((currentPrice - smaChecks[i]) / smaChecks[i]) * 100
        if (currentPrice > smaChecks[i]) { smaBullish++; signals.push({ type: "bullish", text: `Price above ${smaLabels[i]} (${smaPct.toFixed(1)}% above)` }) }
        else { signals.push({ type: "bearish", text: `Price below ${smaLabels[i]} (${Math.abs(smaPct).toFixed(1)}% below)` }) }
      }
    }
    if (smaTotal > 0) score += ((smaBullish / smaTotal) - 0.5) * 25
    if (adx > 0) { score += adx >= 25 ? 5 : -5 }
    if (mfi != null) { if (mfi < 20) score += 8; else if (mfi > 80) score -= 8 }
    if (bbUpper != null && bbLower != null) {
      if (currentPrice >= bbUpper) score -= 8; else if (currentPrice <= bbLower) score += 8
    }
    if (obvPrev != 0 && obv != obvPrev) {
      if ((obv > obvPrev ? 1 : -1) === (change >= 0 ? 1 : -1)) score += 3; else score -= 3
    }
    score = Math.max(0, Math.min(100, Math.round(score)))
    const v = score >= 70 ? ["STRONG BUY", "#00e676"] : score >= 55 ? ["BUY", "#4caf50"] : score >= 45 ? ["HOLD", "#f5a623"] : score >= 30 ? ["CAUTION", "#ff9800"] : ["STRONG SELL", "#ff3c5c"]

    res.json({
      symbol, ai: false, score, verdict: v[0], verdictColor: v[1],
      price: currentPrice, change: { value: change, pct },
      indicators: {
        rsi: rsi != null ? Math.round(rsi * 10) / 10 : null,
        macd: { value: Math.round(macdLine * 100) / 100, signal: Math.round(macdSignal * 100) / 100, histogram: Math.round(macdHist * 100) / 100 },
        sma: { sma5: sma5 ? Math.round(sma5 * 100) / 100 : null, sma20: sma20 ? Math.round(sma20 * 100) / 100 : null, sma50: sma50 ? Math.round(sma50 * 100) / 100 : null, sma200: sma200 ? Math.round(sma200 * 100) / 100 : null },
        adx: Math.round(adx * 10) / 10, mfi: mfi != null ? Math.round(mfi * 10) / 10 : null,
        atr: Math.round(atr * 100) / 100,
      },
      trade: { volume: tradeVol, value: tradeVal, deliveryQty, deliveryPct },
      signals: signals.slice(0, 8),
      summary: (score >= 60 ? "Overall technical structure suggests strength" : score >= 40 ? "Mixed technical signals suggest caution" : "Technical structure appears weak") + ".",
      chartData: chartData,
      depthData: depthData,
    })
  } catch (e) {
    res.json({ error: e.message })
  }
})

app.get("/api/news", async (req, res) => {
  const { symbol, name } = req.query
  const query = encodeURIComponent(name || symbol || "NSE")
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${query}+stock&hl=en-IN&gl=IN&ceid=IN:en`)
    if (!r.ok) return res.json({ articles: [] })
    const xml = await r.text()
    const articles = []
    const itemRe = /<item>([\s\S]*?)<\/item>/g
    let match
    while ((match = itemRe.exec(xml)) !== null) {
      const item = match[1]
      const title = item.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()
      const link = item.match(/<link>([^<]*)<\/link>/)?.[1]?.trim()
      const source = item.match(/<source[^>]*>([^<]*)<\/source>/)?.[1]?.trim()
      const pubDate = item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1]
      if (!title || !link) continue
      articles.push({
        headline: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        url: link.startsWith("http") ? link : `https://news.google.com${link}`,
        source: source || "Google News",
        datetime: pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000),
      })
      if (articles.length >= 10) break
    }
    res.json({ articles })
  } catch {
    res.json({ articles: [] })
  }
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`NSE WebSocket server on http://localhost:${PORT}`)
  connectYFinance()
})
