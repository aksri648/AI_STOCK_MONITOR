import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import AIAnalyticsDashboard from "./AIAnalyticsDashboard"

const C = {
  bg: "#020c18", panel: "#050f1e", panelSel: "#0a1a30",
  border: "#0c1d34", borderBright: "#162840",
  green: "#00e676", red: "#ff3c5c", amber: "#f5a623",
  text: "#c8d8f0", textSec: "#506888", textDim: "#1e3050",
}

const STOCK_META = [
  { id: "n_reliance",  symbol: "RELIANCE",  name: "Reliance Industries",      cap: "₹19.2T", type: "indian" },
  { id: "n_tcs",       symbol: "TCS",       name: "Tata Consultancy Services", cap: "₹15.1T", type: "indian" },
  { id: "n_hdfcbank",  symbol: "HDFCBANK",  name: "HDFC Bank",                cap: "₹12.8T", type: "indian" },
  { id: "n_infy",      symbol: "INFY",      name: "Infosys",                  cap: "₹8.1T",  type: "indian" },
  { id: "n_icicibank", symbol: "ICICIBANK", name: "ICICI Bank",               cap: "₹9.2T",  type: "indian" },
  { id: "n_hindunilvr",symbol: "HINDUNILVR",name: "Hindustan Unilever",       cap: "₹5.9T",  type: "indian" },
  { id: "n_sbin",      symbol: "SBIN",      name: "State Bank of India",      cap: "₹7.4T",  type: "indian" },
  { id: "n_bhartiartl",symbol: "BHARTIARTL",name: "Bharti Airtel",            cap: "₹6.8T",  type: "indian" },
  { id: "n_itc",       symbol: "ITC",       name: "ITC Ltd",                  cap: "₹5.6T",  type: "indian" },
  { id: "n_wipro",     symbol: "WIPRO",     name: "Wipro",                    cap: "₹2.9T",  type: "indian" },
]

const MONO = "'Consolas','Menlo','Monaco','Courier New',monospace"

function fp(n, currency = "₹") {
  if (n == null) return "—"
  if (n < 0.01)  return currency + n.toFixed(6)
  if (n < 1)     return currency + n.toFixed(4)
  if (n >= 1000) return currency + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency + n.toFixed(2)
}

function WatchRow({ asset, selected, onSelect }) {
  const price = asset.price
  const pct   = asset.pct
  const up    = pct >= 0
  const [hov, setHov] = useState(false)
  return (
    <div onClick={() => onSelect(asset)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        padding: "7px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
        background: selected ? C.panelSel : hov ? "#080f1e" : "transparent",
        borderLeft: `2px solid ${selected ? C.amber : "transparent"}`,
        borderBottom: `1px solid ${C.border}`, transition: "background 0.1s",
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: selected ? C.amber : C.text }}>{asset.symbol?.toUpperCase()}</div>
        <div style={{ fontSize: 10, color: C.textSec, marginTop: 1 }}>{(asset.name || "").slice(0, 14)}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        {asset.stockLoading
          ? <div style={{ fontSize: 11, color: C.textDim }}>...</div>
          : <>
              <div style={{ fontSize: 11, color: C.text }}>{fp(price, "₹")}</div>
              <div style={{ fontSize: 10, color: up ? C.green : C.red }}>{up ? "▲" : "▼"} {Math.abs(pct || 0).toFixed(2)}%</div>
            </>
        }
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ minWidth: 80 }}>
      <div style={{ fontSize: 11, color: C.textSec, marginBottom: 3, letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 12, color: C.text, fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function SectionHeader({ label, status, error }) {
  const color = error ? C.red : C.green
  const text  = error ? 'ERROR' : status
  return (
    <div style={{ padding: "6px 12px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 10, color: C.textSec, letterSpacing: 1.5 }}>{label}</span>
      <span style={{ fontSize: 11, color: color }}>● {text}</span>
    </div>
  )
}

export default function FinanceDashboard() {
  const [stocks, setStocks]               = useState(STOCK_META.map(s => ({ ...s, price: null, pct: null, high: null, low: null, stockLoading: true })))
  const [indices, setIndices]             = useState([])
  const [selected, setSelected]           = useState(null)
  const [stocksError, setStocksError]     = useState(false)
  const [wsStatus, setWsStatus]           = useState("connecting")
  const [time, setTime]                   = useState(new Date())
  const [news, setNews]                   = useState([])
  const [newsLoading, setNewsLoading]     = useState(false)
  const [insights, setInsights]           = useState(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

  const [searchQuery, setSearchQuery]     = useState("")
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchOpen, setSearchOpen]       = useState(false)
  const searchRef                         = useRef(null)

  const [isMobile, setIsMobile]           = useState(window.innerWidth < 768)
  const [showDetail, setShowDetail]       = useState(false)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const handler = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  useEffect(() => {
    if (searchQuery.length < 1) { setSearchResults([]); setSearchOpen(false); return }
    const t = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`)
        const data = await r.json()
        setSearchResults(data.results || [])
        setSearchOpen(true)
      } catch { setSearchResults([]) }
      finally { setSearchLoading(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function marketFromHTTP(data) {
    if (data.indices) setIndices(data.indices)
    if (data.stocks) {
      const liveMap = {}
      data.stocks.forEach(d => { liveMap[d.symbol] = d })
      setStocks(STOCK_META.map(meta => {
        const live = liveMap[meta.symbol]
        return { ...meta, price: live?.price ?? null, pct: live?.pct ?? null, high: live?.high ?? null, low: live?.low ?? null, stockLoading: false }
      }))
      setStocksError(false)
    }
  }

  useEffect(() => {
    fetch("/api/indices").then(r => r.json()).then(d => {
      if (d && !d.error) setIndices(d)
    }).catch(() => {})
    fetch("/api/indian").then(r => r.json()).then(d => {
      if (d && !d.error) marketFromHTTP({ stocks: d })
    }).catch(() => {})
  }, [])

  useEffect(() => {
    let ws = null
    let reconnectTimer = null

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
      ws = new WebSocket(`${proto}//${window.location.hostname}:3001`)

      ws.onopen = () => { setWsStatus("connected"); if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null } }
      ws.onclose = () => { setWsStatus("connecting"); scheduleReconnect() }
      ws.onerror = () => { ws?.close() }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type !== "market") return
          marketFromHTTP(msg)
        } catch {}
      }
    }

    function scheduleReconnect() {
      if (reconnectTimer) return
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, 5000)
    }

    connect()
    return () => { if (reconnectTimer) clearTimeout(reconnectTimer); ws?.close() }
  }, [])

  useEffect(() => {
    if (!selected) return
    setNewsLoading(true)
    setNews([])
    const symbol = selected.symbol || selected.id || ""
    const name   = encodeURIComponent(selected.name || selected.symbol || "")
    fetch(`/api/news?symbol=${symbol}&type=indian&name=${name}`)
      .then(r => r.json())
      .then(d => setNews(d.articles || []))
      .catch(() => setNews([]))
      .finally(() => setNewsLoading(false))
    if (selected.type === "indian") {
      setInsightsLoading(true)
      setInsights(null)
      fetch(`/api/insights?symbol=${symbol}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setInsights(d) })
        .catch(() => {})
        .finally(() => setInsightsLoading(false))
    }
  }, [selected?.id])

  useEffect(() => {
    if (selected && stocks.length) {
      const updated = stocks.find(s => s.id === selected.id)
      if (updated) { setSelected(updated); return }
    }
    if (!selected && stocks.length) setSelected(stocks[0])
  }, [stocks])

  const price = selected?.price || 0
  const pct   = selected?.pct || 0
  const up    = pct >= 0

  return (
    <div style={{ background: C.bg, fontFamily: MONO, color: C.text, display: "flex", flexDirection: "column", minHeight: "100vh" }}>

      {/* Header */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: isMobile ? "8px 12px" : "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link to="/" style={{ color: C.amber, fontWeight: 700, fontSize: 15, letterSpacing: 3, textDecoration: "none" }}>▐ MKTVISION</Link>
          <span style={{ color: C.borderBright, fontSize: 20 }}>|</span>
          <span style={{ fontSize: 10, color: C.textSec, letterSpacing: 2 }}>NSE TERMINAL</span>
          <Link to="/calculators" style={{ fontSize: 10, color: C.textSec, letterSpacing: 1.5, textDecoration: "none" }}>CALCULATORS</Link>
          <Link to="/glossary" style={{ fontSize: 10, color: C.textSec, letterSpacing: 1.5, textDecoration: "none" }}>GLOSSARY</Link>
          <Link to="/how-markets-work" style={{ fontSize: 10, color: C.textSec, letterSpacing: 1.5, textDecoration: "none" }}>MARKETS</Link>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {(indices.length ? indices : [
            { name: "NIFTY 50", pct: 0 }, { name: "BANK NIFTY", pct: 0 },
            { name: "NIFTY IT", pct: 0 },  { name: "NIFTY AUTO", pct: 0 },
          ]).map(idx => (
            <span key={idx.name} style={{ fontSize: 11 }}>
              <span style={{ color: C.textSec }}>{idx.name}&nbsp;</span>
              {idx.val != null
                ? <span style={{ color: idx.pct >= 0 ? C.green : C.red }}>{idx.pct >= 0 ? "+" : ""}{idx.pct.toFixed(2)}%</span>
                : <span style={{ color: C.textDim }}>—</span>
              }
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, color: wsStatus === "connected" ? C.green : C.amber }}>●</span>
          <span style={{ fontSize: 12, color: C.amber, fontWeight: 600 }}>
            {time.toLocaleTimeString("en-US", { hour12: false, timeZone: "Asia/Kolkata" })} IST
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1 }}>

        {/* Sidebar */}
        <div style={{ width: isMobile ? '100%' : 210, minWidth: isMobile ? '100%' : 210, borderRight: isMobile ? 'none' : `1px solid ${C.border}`, background: C.panel, display: isMobile && showDetail ? 'none' : "flex", flexDirection: "column", overflowY: "auto" }}>

          {/* Search */}
          <div ref={searchRef} style={{ padding: "8px 10px", borderBottom: `1px solid ${C.border}`, position: "relative" }}>
            <input
              type="text"
              placeholder="⌕  Search any ticker..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length && setSearchOpen(true)}
              style={{ width: "100%", background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: "5px 8px", fontSize: 11, fontFamily: MONO, borderRadius: 3, outline: "none", boxSizing: "border-box" }}
            />
            {searchLoading && <div style={{ position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: C.textDim }}>...</div>}
            {searchOpen && searchResults.length > 0 && (
              <div style={{ position: "absolute", top: "calc(100% - 2px)", left: 10, right: 10, background: C.panel, border: `1px solid ${C.borderBright}`, borderRadius: "0 0 3px 3px", zIndex: 200, maxHeight: 220, overflowY: "auto" }}>
                {searchResults.map(r => (
                  <div key={r.symbol} onClick={() => { setSearchQuery(""); setSearchResults([]); setSearchOpen(false) }}
                    style={{ padding: "7px 10px", cursor: "pointer", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "baseline" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#0a1828"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.amber, minWidth: 48 }}>{r.symbol}</span>
                    <span style={{ fontSize: 10, color: C.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <SectionHeader label="NSE EQUITIES" status={wsStatus === "connected" ? "LIVE" : "CONNECTING"} error={stocksError} />
          {stocks.map(s => <WatchRow key={s.id} asset={s} selected={selected?.id === s.id} onSelect={a => { setSelected(a); if (isMobile) setShowDetail(true) }} />)}
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: isMobile && !showDetail ? "none" : "flex", flexDirection: "column", minWidth: 0 }}>

          {/* Asset info */}
          <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
            <div>
              {isMobile && (
                <button onClick={() => setShowDetail(false)} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.amber, padding: '4px 10px', fontSize: 10, fontFamily: MONO, cursor: 'pointer', borderRadius: 2, marginBottom: 10, letterSpacing: 1 }}>
                  ← BACK
                </button>
              )}
              <div style={{ fontSize: 10, color: C.textSec, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 600, color: C.text }}>{selected?.name || "—"}</span>
                {selected?.type === "indian" && <span style={{ fontSize: 11, color: C.amber }}>NSE</span>}
                <span style={{ fontSize: 11, color: C.green }}>● LIVE</span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                {selected?.stockLoading
                  ? <span style={{ fontSize: 28, color: C.textDim }}>loading...</span>
                  : <>
                      <span style={{ fontSize: 32, fontWeight: 700, color: C.text, letterSpacing: -0.5 }}>{fp(price)}</span>
                      <span style={{ fontSize: 16, color: up ? C.green : C.red, fontWeight: 600 }}>{up ? "▲" : "▼"} {Math.abs(pct || 0).toFixed(2)}%</span>
                    </>
              }
              </div>
            </div>
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap", paddingBottom: 4 }}>
              <Stat label="MKT CAP"  value={selected?.cap || "—"} />
              <Stat label="52W HIGH" value={fp(selected?.high, "₹")} />
              <Stat label="52W LOW"  value={fp(selected?.low, "₹")} />
            </div>
          </div>

          {/* News */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px" }}>
            <div style={{ fontSize: 10, color: C.textSec, marginBottom: 10, letterSpacing: 1.5 }}>
              LATEST NEWS
            </div>
            {newsLoading
              ? <div style={{ fontSize: 11, color: C.textDim }}>loading news...</div>
              : news.length === 0
              ? <div style={{ fontSize: 11, color: C.textDim }}>no news available</div>
              : news.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: "block", textDecoration: "none", padding: "7px 0", borderBottom: `1px solid ${C.border}` }}
                  onMouseEnter={e => e.currentTarget.style.background = "#0a1828"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div style={{ fontSize: 12, color: C.text, lineHeight: 1.4, flex: 1 }}>
                      {a.headline.length > 80 ? a.headline.slice(0, 80) + "..." : a.headline}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: C.amber }}>{a.source}</span>
                      <span style={{ fontSize: 10, color: C.textDim }}>
                        {(() => {
                          const diff = Math.floor((Date.now() - a.datetime * 1000) / 60000)
                          if (diff < 60) return diff + "m ago"
                          if (diff < 1440) return Math.floor(diff / 60) + "h ago"
                          return Math.floor(diff / 1440) + "d ago"
                        })()}
                      </span>
                    </div>
                  </div>
                </a>
              ))
            }
          </div>

          {/* AI Insights Dashboard */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px" }}>
            <div style={{ fontSize: 10, color: C.textSec, marginBottom: 10, letterSpacing: 1.5 }}>AI INSIGHTS ANALYTICS</div>
            <AIAnalyticsDashboard
              insights={insights}
              insightsLoading={insightsLoading}
              selectedType={selected?.type}
            />
          </div>

          {/* Movers strip */}
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "10px 16px" }}>
            <div style={{ fontSize: 10, color: C.textSec, marginBottom: 8, letterSpacing: 1.5 }}>MARKET MOVERS</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {stocks.map(a => {
                const p2 = a.pct ?? 0
                const u2 = p2 >= 0
                return (
                  <div key={a.id || a.symbol} onClick={() => setSelected(a)}
                    style={{ padding: "6px 10px", border: `1px solid ${selected?.id === a.id ? C.amber : C.border}`, borderRadius: 3, cursor: "pointer", background: selected?.id === a.id ? "#0f1e34" : "transparent", minWidth: 72, opacity: a.stockLoading ? 0.4 : 1 }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: selected?.id === a.id ? C.amber : C.text }}>{(a.symbol || "").toUpperCase()}</div>
                    <div style={{ fontSize: 10, color: u2 ? C.green : C.red, marginTop: 2 }}>
                      {a.stockLoading ? "..." : `${u2 ? "▲" : "▼"} ${Math.abs(p2 || 0).toFixed(2)}%`}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: "5px 16px", background: C.panel, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
        <span style={{ fontSize: 10, color: C.textDim }}>INDICES + STOCKS: YFINANCE WEBSOCKET · HISTORICAL: STOCK-NSE-INDIA</span>
        <span style={{ fontSize: 10, color: C.textDim }}>MKTVISION · REACT</span>
      </div>
    </div>
  )
}
