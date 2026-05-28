import {
  ResponsiveContainer, ComposedChart, LineChart, BarChart,
  Line, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceArea,
} from 'recharts'

const C = {
  bg: '#020c18', panel: '#050f1e', panel2: '#080f1e',
  border: '#0c1d34', borderBright: '#162840',
  green: '#00e676', red: '#ff3c5c', amber: '#f5a623', blue: '#2196f3',
  text: '#c8d8f0', textSec: '#506888', textDim: '#1e3050',
}
const MONO = "'Consolas','Menlo','Monaco','Courier New',monospace"

function fmt(n) {
  if (n == null || isNaN(n)) return '—'
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + 'Cr'
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + 'L'
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-IN')
  return n.toFixed(2)
}

function shortDate(d) {
  if (!d) return ''
  const p = d.split('-')
  return p.length === 3 ? p[0] + ' ' + p[1].slice(0, 3) : d
}

const TooltipBox = ({ active, payload, label, fields }) => {
  if (!active || !payload?.length) return null
  const data = payload[0]?.payload || {}
  return (
    <div style={{ background: '#0a1a2e', border: `1px solid ${C.borderBright}`, borderRadius: 3, padding: '6px 10px', fontSize: 11, fontFamily: MONO }}>
      <div style={{ color: C.textSec, marginBottom: 3 }}>{data.date || label}</div>
      {(fields || ['close']).map(f => (
        data[f] != null && <div key={f} style={{ color: f === 'close' ? C.amber : f === 'volume' ? C.blue : f === 'rsi' ? C.amber : C.text }}>
          {f.toUpperCase()}: {f === 'volume' ? fmt(data[f]) : f === 'rsi' ? data[f].toFixed(1) : '₹' + data[f].toFixed(2)}
        </div>
      ))}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: C.panel2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '12px 16px', flex: '1 1 130px' }}>
      <div style={{ fontSize: 9, color: C.textSec, letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || C.text }}>{value}</div>
    </div>
  )
}

export default function AIAnalyticsDashboard({ insights, insightsLoading, selectedType }) {
  if (selectedType !== 'indian') {
    return <div style={{ padding: '12px 0', fontSize: 11, color: C.textDim }}>Select an NSE stock to view analytics</div>
  }

  if (insightsLoading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center' }}>
        <div style={{ fontSize: 20, color: C.amber, marginBottom: 8 }}>⟳</div>
        <div style={{ fontSize: 11, color: C.textDim }}>Fetching AI insights & chart data...</div>
      </div>
    )
  }

  if (!insights) {
    return <div style={{ padding: '12px 0', fontSize: 11, color: C.textDim }}>No data available</div>
  }

  const { score, verdict, verdictColor, signals, summary, chartData, depthData, indicators, trade, price, change } = insights
  const up = change?.pct >= 0

  const avgClose = chartData?.length ? (chartData.reduce((s, d) => s + d.close, 0) / chartData.length) : 0
  const maxClose = chartData?.length ? Math.max(...chartData.map(d => d.close)) : 0
  const minClose = chartData?.length ? Math.min(...chartData.map(d => d.close)) : 0
  const maxVol = chartData?.length ? Math.max(...chartData.map(d => d.volume || 0)) : 0

  return (
    <div>

      {/* TOP ROW: Score meter + Key stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '12px 16px', flex: '0 0 220px' }}>
          <div style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5, marginBottom: 6 }}>AI VERDICT</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: verdictColor, fontWeight: 700, letterSpacing: 1.5 }}>{verdict}</span>
            <span style={{ fontSize: 24, fontWeight: 700, color: verdictColor }}>{score}<span style={{ fontSize: 12, color: C.textDim }}>/100</span></span>
          </div>
          <div style={{ height: 5, background: C.bg, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${score}%`, background: verdictColor, transition: 'width 0.5s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 8, color: C.textDim }}><span>SELL</span><span>HOLD</span><span>BUY</span></div>
          {summary && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.textSec, lineHeight: 1.5, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
              {summary}
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap', alignContent: 'flex-start' }}>
          <StatCard label="PRICE" value={`₹${price?.toFixed(2) || '—'}`} color={up ? C.green : C.red} />
          <StatCard label="CHG %" value={`${up ? '+' : ''}${change?.pct?.toFixed(2) || 0}%`} color={up ? C.green : C.red} />
          <StatCard label="RSI (14)" value={indicators?.rsi?.toFixed(1) || '—'} color={indicators?.rsi > 65 ? C.red : indicators?.rsi < 40 ? C.green : C.amber} />
          <StatCard label="ADX" value={indicators?.adx?.toFixed(1) || '—'} color={indicators?.adx >= 25 ? C.green : C.amber} />
          <StatCard label="MFI" value={indicators?.mfi?.toFixed(1) || '—'} color={indicators?.mfi > 75 ? C.red : indicators?.mfi < 25 ? C.green : C.amber} />
          <StatCard label="ATR" value={indicators?.atr ? `₹${indicators.atr.toFixed(1)}` : '—'} color={C.amber} />
          <StatCard label="MACD" value={indicators?.macd?.histogram?.toFixed(2) || '—'} color={indicators?.macd?.histogram >= 0 ? C.green : C.red} />
          <StatCard label="VOL" value={trade?.volume ? fmt(trade.volume) : '—'} color={C.blue} />
        </div>
      </div>

      {/* PRICE CHART */}
      {chartData?.length > 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5 }}>PRICE · CLOSE (60D)</span>
            <div style={{ display: 'flex', gap: 12, fontSize: 9 }}>
              <span style={{ color: C.textDim }}>₹{minClose.toFixed(0)}</span>
              <span style={{ color: C.amber, fontWeight: 600 }}>₹{price?.toFixed(2)}</span>
              <span style={{ color: C.textDim }}>₹{maxClose.toFixed(0)}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.amber} stopOpacity={0.12} />
                  <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
              <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 9, fill: C.textDim }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="p" domain={[minClose * 0.98, maxClose * 1.02]} tick={{ fontSize: 9, fill: C.textDim }} tickLine={false} axisLine={false} width={55} tickFormatter={v => '₹' + v.toFixed(0)} />
              <YAxis yAxisId="v" orientation="right" domain={[0, maxVol * 4]} tick={{ fontSize: 9, fill: C.textDim }} tickLine={false} axisLine={false} width={45} tickFormatter={v => fmt(v)} />
              <TooltipBox fields={['close', 'volume']} />
              <Bar yAxisId="v" dataKey="volume" fill={C.blue} opacity={0.25} barSize={4} />
              <Line yAxisId="p" type="monotone" dataKey="close" stroke={C.amber} strokeWidth={2} dot={false} />
              {indicators?.sma?.sma20 && <Line yAxisId="p" type="monotone" dataKey="sma20" stroke={C.green} strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls />}
              {indicators?.sma?.sma50 && <Line yAxisId="p" type="monotone" dataKey="sma50" stroke={C.blue} strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* AI SIGNALS */}
      {signals?.length > 0 && (
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5, marginBottom: 8 }}>AI SIGNALS · TEXT INSIGHTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {signals.map((s, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 8px',
                background: C.panel2, borderRadius: 2,
                borderLeft: `3px solid ${s.type === 'bullish' ? C.green : s.type === 'bearish' ? C.red : C.amber}`,
              }}>
                <span style={{ fontSize: 11, color: s.type === 'bullish' ? C.green : s.type === 'bearish' ? C.red : C.amber, flexShrink: 0, minWidth: 16 }}>
                  {s.type === 'bullish' ? '▲' : s.type === 'bearish' ? '▼' : '◆'}
                </span>
                <span style={{ fontSize: 11, color: C.text, lineHeight: 1.4 }}>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RSI + MACD SIDE BY SIDE */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {chartData?.length > 0 && indicators?.rsi != null && (
          <div style={{ flex: '1 1 300px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5 }}>RSI (14)</span>
              <span style={{ fontSize: 10, color: indicators.rsi > 65 ? C.red : indicators.rsi < 40 ? C.green : C.amber, fontWeight: 600 }}>{indicators.rsi.toFixed(1)}</span>
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={chartData}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 8, fill: C.textDim }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: C.textDim }} tickLine={false} axisLine={false} width={24} />
                <ReferenceArea y1={70} y2={100} fill={C.red} fillOpacity={0.06} />
                <ReferenceArea y1={0} y2={30} fill={C.green} fillOpacity={0.06} />
                <ReferenceLine y={70} stroke={C.red} strokeDasharray="3 3" strokeOpacity={0.3} />
                <ReferenceLine y={30} stroke={C.green} strokeDasharray="3 3" strokeOpacity={0.3} />
                <ReferenceLine y={50} stroke={C.textDim} strokeDasharray="2 2" strokeOpacity={0.2} />
                <Line type="monotone" dataKey="close" stroke={C.amber} strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {chartData?.length > 0 && indicators?.macd?.histogram != null && (
          <div style={{ flex: '1 1 300px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '10px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5 }}>MACD</span>
              <div style={{ display: 'flex', gap: 10, fontSize: 9 }}>
                <span>MACD <span style={{ color: C.amber, fontWeight: 600 }}>{indicators.macd.value.toFixed(2)}</span></span>
                <span>SIG <span style={{ color: C.blue, fontWeight: 600 }}>{indicators.macd.signal.toFixed(2)}</span></span>
                <span>HIST <span style={{ color: indicators.macd.histogram >= 0 ? C.green : C.red, fontWeight: 600 }}>{indicators.macd.histogram > 0 ? '+' : ''}{indicators.macd.histogram.toFixed(2)}</span></span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <ComposedChart data={chartData}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 8, fill: C.textDim }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 8, fill: C.textDim }} tickLine={false} axisLine={false} width={40} />
                <Bar dataKey="high" fill={C.amber} opacity={0.08} />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ fontSize: 10, color: indicators.macd.histogram >= 0 ? C.green : C.red, marginTop: 4 }}>
              MACD {indicators.macd.histogram >= 0 ? 'above' : 'below'} signal · {indicators.macd.histogram >= 0 ? 'Bullish' : 'Bearish'} momentum
            </div>
          </div>
        )}
      </div>

      {/* ORDER BOOK DEPTH + TRADE STATS */}
      {depthData && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: '1 1 280px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5, marginBottom: 8 }}>ORDER BOOK DEPTH</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: C.green, marginBottom: 4, textAlign: 'center', letterSpacing: 1 }}>BIDS</div>
                {depthData.bids?.map((b, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, height: 18 }}>
                    <span style={{ fontSize: 9, color: C.text, minWidth: 48, textAlign: 'right' }}>₹{b.price?.toFixed(1)}</span>
                    <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(b.quantity / depthData.maxBidQty) * 100}%`, background: C.green, opacity: 0.5, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 9, color: C.textSec, minWidth: 35, textAlign: 'right' }}>{b.quantity}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: C.red, marginBottom: 4, textAlign: 'center', letterSpacing: 1 }}>ASKS</div>
                {depthData.asks?.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, height: 18 }}>
                    <span style={{ fontSize: 9, color: C.text, minWidth: 48, textAlign: 'right' }}>₹{a.price?.toFixed(1)}</span>
                    <div style={{ flex: 1, height: 14, background: C.bg, borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${(a.quantity / depthData.maxAskQty) * 100}%`, background: C.red, opacity: 0.5, borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 9, color: C.textSec, minWidth: 35, textAlign: 'right' }}>{a.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 200px', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5, marginBottom: 8 }}>TRADE STATS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {trade?.volume > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: C.textSec }}>Volume</span><span style={{ color: C.blue, fontWeight: 600 }}>{fmt(trade.volume)}</span>
                </div>
              )}
              {trade?.value > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: C.textSec }}>Turnover</span><span style={{ color: C.amber, fontWeight: 600 }}>₹{fmt(trade.value)}Cr</span>
                </div>
              )}
              {trade?.deliveryQty > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: C.textSec }}>Delivery</span><span style={{ color: C.green, fontWeight: 600 }}>{fmt(trade.deliveryQty)}</span>
                </div>
              )}
              {trade?.deliveryPct > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: C.textSec }}>Del %</span><span style={{ color: trade.deliveryPct > 50 ? C.green : C.amber, fontWeight: 600 }}>{trade.deliveryPct.toFixed(1)}%</span>
                </div>
              )}
              {indicators?.atr > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: C.textSec }}>ATR</span><span style={{ color: C.amber, fontWeight: 600 }}>₹{indicators.atr.toFixed(2)}</span>
                </div>
              )}
              {indicators?.adx > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: C.textSec }}>ADX</span><span style={{ color: indicators.adx >= 25 ? C.green : C.amber, fontWeight: 600 }}>{indicators.adx.toFixed(1)}</span>
                </div>
              )}
              {chartData?.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                  <span style={{ color: C.textSec }}>Avg Vol</span><span style={{ color: C.blue, fontWeight: 600 }}>{fmt(Math.round(chartData.reduce((s, d) => s + (d.volume || 0), 0) / chartData.length))}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SMA POSITIONS */}
      <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: '10px 12px' }}>
        <div style={{ fontSize: 9, color: C.textSec, letterSpacing: 1.5, marginBottom: 6 }}>SMA POSITIONS · PRICE vs MOVING AVERAGES</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {[
            { label: 'SMA(5)', val: indicators?.sma?.sma5 },
            { label: 'SMA(20)', val: indicators?.sma?.sma20 },
            { label: 'SMA(50)', val: indicators?.sma?.sma50 },
            { label: 'SMA(200)', val: indicators?.sma?.sma200 },
          ].map(s => {
            const above = price > s.val
            return (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.panel2, borderRadius: 2, fontSize: 11 }}>
                <span style={{ color: C.textSec, minWidth: 60 }}>{s.label}</span>
                <span style={{ color: C.text, minWidth: 70, textAlign: 'right' }}>{s.val != null ? `₹${s.val.toFixed(2)}` : '—'}</span>
                <span style={{ color: above ? C.green : C.red, minWidth: 90, textAlign: 'right' }}>
                  {price != null && s.val != null ? `${above ? '▲ Above' : '▼ Below'} (${Math.abs(((price - s.val) / s.val) * 100).toFixed(1)}%)` : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
