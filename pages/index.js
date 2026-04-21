import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'

// ─── ML API (chamada direta do browser — suporta CORS) ──────
async function searchML(q, limit = 8) {
  const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(q)}&limit=${limit}&sort=price_asc`
  const res  = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Mercado Livre retornou erro ${res.status}`)
  const data = await res.json()

  const results = (data.results || []).map(item => ({
    id:           item.id,
    title:        item.title,
    price:        item.price,
    currency:     item.currency_id,
    condition:    item.condition === 'new' ? 'Novo' : 'Usado',
    seller:       item.seller?.nickname || 'Vendedor',
    link:         item.permalink,
    thumbnail:    item.thumbnail?.replace('http://', 'https://'),
    installments: item.installments
      ? `${item.installments.quantity}x R$ ${item.installments.amount.toFixed(2).replace('.', ',')}`
      : null,
    freeShipping: item.shipping?.free_shipping || false,
    available:    item.available_quantity || 0,
    sold:         item.sold_quantity || 0,
  }))

  const prices = results.map(r => r.price)
  return {
    query:   q,
    total:   data.paging?.total || 0,
    results,
    stats: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      avg: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length * 100) / 100 : 0,
    },
  }
}

// ─── helpers ────────────────────────────────────────────────
const fmt = (n) =>
  n != null
    ? 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'

const scoreColor = (pct) => {
  if (pct >= 15) return '#4ade80'
  if (pct >= 5)  return '#facc15'
  if (pct >= 0)  return '#fb923c'
  return '#f87171'
}

const scoreLabel = (pct) => {
  if (pct >= 15) return '🟢 Ótimo'
  if (pct >= 5)  return '🟡 Bom'
  if (pct >= 0)  return '🟠 Aguarde'
  return '🔴 Alto'
}

// ─── localStorage ────────────────────────────────────────────
const STORAGE_KEY = 'pricehawk_watchlist'
const loadWatchlist = () => {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
const saveWatchlist = (list) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

// ════════════════════════════════════════════════════════════
export default function PriceHawk() {
  const [watchlist,   setWatchlist]   = useState([])
  const [query,       setQuery]       = useState('')
  const [searching,   setSearching]   = useState(false)
  const [results,     setResults]     = useState(null)
  const [error,       setError]       = useState('')
  const [activeTab,   setActiveTab]   = useState('watch')  // 'watch' | 'search'
  const [refreshing,  setRefreshing]  = useState(false)
  const [notification,setNotification]= useState(null)
  const [mounted,     setMounted]     = useState(false)

  // load from localStorage on mount
  useEffect(() => {
    setWatchlist(loadWatchlist())
    setMounted(true)
  }, [])

  // ── save whenever watchlist changes ──
  useEffect(() => {
    if (mounted) saveWatchlist(watchlist)
  }, [watchlist, mounted])

  // ── search ──────────────────────────────────────────────
  const search = useCallback(async (q) => {
    if (!q.trim()) return
    setSearching(true)
    setError('')
    setResults(null)
    setActiveTab('search')
    try {
      const data = await searchML(q, 8)
      setResults(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }, [])

  const onKeyDown = (e) => { if (e.key === 'Enter') search(query) }

  // ── add to watchlist ─────────────────────────────────────
  const addToWatch = (item, targetPrice) => {
    const already = watchlist.find(w => w.id === item.id)
    if (already) {
      notify('⚠️ Produto já está na lista!')
      return
    }
    const entry = {
      ...item,
      targetPrice:  targetPrice || null,
      addedAt:      Date.now(),
      priceHistory: [{ price: item.price, date: Date.now() }],
      lowestSeen:   item.price,
    }
    setWatchlist(prev => [entry, ...prev])
    notify('✅ Adicionado à lista!')
  }

  const removeFromWatch = (id) => {
    setWatchlist(prev => prev.filter(w => w.id !== id))
  }

  const updateTarget = (id, val) => {
    setWatchlist(prev =>
      prev.map(w => w.id === id ? { ...w, targetPrice: val ? parseFloat(val) : null } : w)
    )
  }

  // ── refresh all watchlist prices ─────────────────────────
  const refreshAll = useCallback(async () => {
    if (!watchlist.length || refreshing) return
    setRefreshing(true)
    let alerts = []

    const updated = await Promise.all(
      watchlist.map(async (item) => {
        try {
          const data = await searchML(item.title, 3)
          if (!data.results?.length) return item

          const newPrice = data.stats.min
          const history  = [{ price: newPrice, date: Date.now() }, ...(item.priceHistory || [])].slice(0, 20)
          const lowest   = Math.min(newPrice, item.lowestSeen || newPrice)

          if (item.targetPrice && newPrice <= item.targetPrice) {
            alerts.push(`${item.title.slice(0, 30)}… → ${fmt(newPrice)}`)
          }

          return { ...item, price: newPrice, priceHistory: history, lowestSeen: lowest }
        } catch { return item }
      })
    )

    setWatchlist(updated)
    setRefreshing(false)

    if (alerts.length) {
      notify(`🔔 ${alerts.length} alerta(s)!\n${alerts.join('\n')}`, 5000)
    } else {
      notify('✅ Preços atualizados!')
    }
  }, [watchlist, refreshing])

  // ── notification helper ──────────────────────────────────
  const notify = (msg, duration = 2500) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), duration)
  }

  // ── alerts count ─────────────────────────────────────────
  const alertCount = watchlist.filter(
    w => w.targetPrice && w.price <= w.targetPrice
  ).length

  // ════════════════════════════════════════════════════════
  return (
    <>
      <Head>
        <title>PriceHawk</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">

        {/* ── notification toast ── */}
        {notification && (
          <div className="toast">
            <span>{notification}</span>
          </div>
        )}

        {/* ── header ── */}
        <header className="header">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">PRICE<span className="accent">HAWK</span></span>
          </div>
          {alertCount > 0 && (
            <div className="alert-badge" onClick={() => setActiveTab('watch')}>
              🔔 {alertCount} alerta{alertCount > 1 ? 's' : ''}
            </div>
          )}
        </header>

        {/* ── search bar ── */}
        <div className="search-wrap">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              className="search-input"
              type="text"
              placeholder="Ex: iPhone 15 Pro, Notebook Dell, AirFryer..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {query && (
              <button className="clear-btn" onClick={() => { setQuery(''); setResults(null); setActiveTab('watch') }}>✕</button>
            )}
          </div>
          <button className="search-btn" onClick={() => search(query)} disabled={searching || !query.trim()}>
            {searching ? <span className="spin">⟳</span> : 'Buscar'}
          </button>
        </div>

        {/* ── tabs ── */}
        <div className="tabs">
          <button className={`tab ${activeTab === 'watch' ? 'active' : ''}`} onClick={() => setActiveTab('watch')}>
            📋 Monitorando ({watchlist.length})
          </button>
          <button className={`tab ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>
            🔎 Resultados {results ? `(${results.results.length})` : ''}
          </button>
        </div>

        <main className="main">

          {/* ═══ WATCHLIST TAB ═══ */}
          {activeTab === 'watch' && (
            <div className="watch-tab">
              {watchlist.length === 0 ? (
                <div className="empty">
                  <div className="empty-icon">🦅</div>
                  <p>Sua lista está vazia.</p>
                  <p className="empty-sub">Busque um produto e clique em <strong>+ Monitorar</strong></p>
                </div>
              ) : (
                <>
                  <div className="watch-actions">
                    <span className="watch-count">{watchlist.length} produto{watchlist.length > 1 ? 's' : ''}</span>
                    <button className="refresh-btn" onClick={refreshAll} disabled={refreshing}>
                      {refreshing ? <><span className="spin">⟳</span> Atualizando…</> : '⟳ Atualizar Preços'}
                    </button>
                  </div>
                  <div className="card-list">
                    {watchlist.map(item => {
                      const isAlert = item.targetPrice && item.price <= item.targetPrice
                      const lowestPct = item.lowestSeen
                        ? ((item.lowestSeen - item.price) / item.lowestSeen) * 100
                        : 0
                      const drop = item.priceHistory?.length > 1
                        ? item.priceHistory[0].price - item.priceHistory[1].price
                        : 0

                      return (
                        <div key={item.id} className={`watch-card ${isAlert ? 'alerting' : ''}`}>
                          {isAlert && <div className="alert-ribbon">🔔 NO PREÇO ALVO!</div>}
                          <div className="card-inner">
                            <img src={item.thumbnail} alt="" className="thumb" />
                            <div className="card-body">
                              <p className="card-title">{item.title}</p>
                              <div className="card-meta">
                                <span className="condition">{item.condition}</span>
                                {item.freeShipping && <span className="free-ship">Frete grátis</span>}
                                {item.installments && <span className="installments">{item.installments}</span>}
                              </div>
                              <div className="price-row">
                                <span className="current-price">{fmt(item.price)}</span>
                                {drop !== 0 && (
                                  <span className={`delta ${drop < 0 ? 'up' : 'down'}`}>
                                    {drop < 0 ? '↑' : '↓'} {fmt(Math.abs(drop))}
                                  </span>
                                )}
                              </div>
                              <div className="score-row">
                                <span className="score-label" style={{ color: scoreColor(lowestPct) }}>
                                  {scoreLabel(lowestPct)}
                                </span>
                                {item.lowestSeen < item.price && (
                                  <span className="lowest">Mínimo: {fmt(item.lowestSeen)}</span>
                                )}
                              </div>
                              <div className="target-row">
                                <label className="target-label">Alvo R$</label>
                                <input
                                  type="number"
                                  className="target-input"
                                  placeholder="0,00"
                                  value={item.targetPrice || ''}
                                  onChange={e => updateTarget(item.id, e.target.value)}
                                />
                                <a href={item.link} target="_blank" rel="noreferrer" className="view-btn">Ver →</a>
                                <button className="remove-btn" onClick={() => removeFromWatch(item.id)}>✕</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ SEARCH RESULTS TAB ═══ */}
          {activeTab === 'search' && (
            <div className="search-tab">
              {searching && (
                <div className="loading">
                  <div className="pulse">⚡</div>
                  <p>Buscando no Mercado Livre…</p>
                </div>
              )}
              {error && <div className="error-box">⚠️ {error}</div>}
              {results && !searching && (
                <>
                  <div className="results-header">
                    <span className="results-query">"{results.query}"</span>
                    <span className="results-total">{results.total.toLocaleString()} resultados</span>
                  </div>

                  {/* price stats */}
                  <div className="stats-bar">
                    <div className="stat"><span className="stat-label">MENOR</span><span className="stat-val green">{fmt(results.stats.min)}</span></div>
                    <div className="stat-div" />
                    <div className="stat"><span className="stat-label">MÉDIO</span><span className="stat-val">{fmt(results.stats.avg)}</span></div>
                    <div className="stat-div" />
                    <div className="stat"><span className="stat-label">MAIOR</span><span className="stat-val red">{fmt(results.stats.max)}</span></div>
                  </div>

                  <div className="card-list">
                    {results.results.map((item, idx) => {
                      const savePct = results.stats.max > 0
                        ? ((results.stats.max - item.price) / results.stats.max) * 100
                        : 0
                      const inWatch = watchlist.some(w => w.id === item.id)
                      return (
                        <div key={item.id} className={`result-card ${idx === 0 ? 'best' : ''}`}>
                          {idx === 0 && <div className="best-badge">⚡ Melhor Preço</div>}
                          <div className="card-inner">
                            <img src={item.thumbnail} alt="" className="thumb" />
                            <div className="card-body">
                              <p className="card-title">{item.title}</p>
                              <div className="card-meta">
                                <span className="seller">🏪 {item.seller}</span>
                                <span className="condition">{item.condition}</span>
                                {item.freeShipping && <span className="free-ship">Frete grátis</span>}
                              </div>
                              <div className="price-row">
                                <span className="current-price">{fmt(item.price)}</span>
                                {item.installments && <span className="installments">{item.installments}</span>}
                                {savePct > 5 && (
                                  <span className="save-badge">−{savePct.toFixed(0)}% vs maior</span>
                                )}
                              </div>
                              <div className="result-actions">
                                <a href={item.link} target="_blank" rel="noreferrer" className="view-btn">
                                  Ver no ML →
                                </a>
                                <AddButton inWatch={inWatch} onAdd={(target) => addToWatch(item, target)} />
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {!results && !searching && !error && (
                <div className="empty">
                  <div className="empty-icon">🔍</div>
                  <p>Digite um produto e pressione Buscar</p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { background: #080c10; }
        body { background: #080c10; color: #e2e8f0; font-family: 'DM Mono', monospace; min-height: 100dvh; }

        .app { max-width: 680px; margin: 0 auto; padding: 0 0 80px; min-height: 100dvh; }

        /* header */
        .header { display: flex; align-items: center; justify-content: space-between;
          padding: 20px 20px 0; }
        .logo { display: flex; align-items: center; gap: 10px; }
        .logo-icon { font-size: 22px; }
        .logo-text { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 20px;
          letter-spacing: 3px; color: #fff; }
        .accent { color: #4ade80; }
        .alert-badge { background: #16a34a22; border: 1px solid #4ade8044; border-radius: 20px;
          padding: 5px 14px; font-size: 12px; color: #4ade80; cursor: pointer;
          animation: pulse 2s infinite; }

        /* search */
        .search-wrap { display: flex; gap: 10px; padding: 18px 16px 0; }
        .search-box { flex: 1; display: flex; align-items: center; background: #0f1318;
          border: 1px solid #1e2530; border-radius: 12px; padding: 0 14px; gap: 10px;
          transition: border-color .2s; }
        .search-box:focus-within { border-color: #4ade8066; }
        .search-icon { font-size: 16px; flex-shrink: 0; opacity: .5; }
        .search-input { flex: 1; background: transparent; border: none; outline: none;
          color: #e2e8f0; font-family: 'DM Mono', monospace; font-size: 14px; padding: 14px 0; }
        .search-input::placeholder { color: #3a4450; }
        .clear-btn { background: none; border: none; color: #3a4450; cursor: pointer; font-size: 14px;
          padding: 4px; transition: color .2s; }
        .clear-btn:hover { color: #94a3b8; }
        .search-btn { background: linear-gradient(135deg, #4ade80, #22c55e); border: none;
          border-radius: 12px; padding: 0 22px; color: #052e16; font-family: 'Syne', sans-serif;
          font-weight: 700; font-size: 14px; cursor: pointer; white-space: nowrap;
          transition: opacity .2s; height: 52px; letter-spacing: 1px; }
        .search-btn:disabled { opacity: .4; cursor: not-allowed; }

        /* tabs */
        .tabs { display: flex; padding: 16px 16px 0; gap: 4px; }
        .tab { flex: 1; background: transparent; border: none; border-bottom: 2px solid transparent;
          padding: 10px 8px; color: #3a4450; font-family: 'DM Mono', monospace; font-size: 12px;
          cursor: pointer; transition: all .2s; }
        .tab.active { color: #4ade80; border-bottom-color: #4ade80; }

        /* main */
        .main { padding: 16px; }

        /* watch actions */
        .watch-actions { display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px; }
        .watch-count { font-size: 11px; color: #4a5568; letter-spacing: 2px; text-transform: uppercase; }
        .refresh-btn { background: #0f1318; border: 1px solid #1e2530; border-radius: 8px;
          padding: 7px 16px; color: #94a3b8; font-family: 'DM Mono', monospace; font-size: 12px;
          cursor: pointer; transition: all .2s; display: flex; align-items: center; gap: 6px; }
        .refresh-btn:hover { border-color: #4ade8044; color: #4ade80; }
        .refresh-btn:disabled { opacity: .5; cursor: not-allowed; }

        /* cards */
        .card-list { display: flex; flex-direction: column; gap: 12px; }

        .watch-card, .result-card {
          background: #0c1015; border: 1px solid #1a2030; border-radius: 16px;
          overflow: hidden; position: relative; transition: border-color .3s;
        }
        .watch-card.alerting { border-color: #4ade8055; background: #080f0c; }
        .result-card.best { border-color: #4ade8033; }
        .alert-ribbon, .best-badge {
          padding: 5px 14px; font-size: 11px; font-weight: 700; text-align: center;
          letter-spacing: 1px;
        }
        .alert-ribbon { background: #052e16; color: #4ade80; }
        .best-badge { background: #4ade8011; color: #4ade80; border-bottom: 1px solid #4ade8022; }

        .card-inner { display: flex; gap: 14px; padding: 16px; }
        .thumb { width: 72px; height: 72px; object-fit: contain; border-radius: 10px;
          background: #131920; flex-shrink: 0; }
        .card-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }

        .card-title { font-size: 13px; color: #cbd5e1; line-height: 1.4;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

        .card-meta { display: flex; flex-wrap: wrap; gap: 6px; }
        .condition { font-size: 10px; background: #1e2530; color: #64748b;
          padding: 2px 8px; border-radius: 6px; }
        .free-ship { font-size: 10px; background: #052e16; color: #4ade80;
          padding: 2px 8px; border-radius: 6px; }
        .installments { font-size: 10px; color: #64748b; }
        .seller { font-size: 11px; color: #4a5568; }

        .price-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .current-price { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 20px; color: #f1f5f9; }
        .delta { font-size: 11px; padding: 2px 8px; border-radius: 6px; }
        .delta.down { background: #052e16; color: #4ade80; }
        .delta.up   { background: #300; color: #f87171; }
        .save-badge { font-size: 11px; background: #052e16; color: #4ade80;
          padding: 2px 8px; border-radius: 6px; }

        .score-row { display: flex; align-items: center; gap: 10px; }
        .score-label { font-size: 11px; font-weight: 600; }
        .lowest { font-size: 10px; color: #4a5568; }

        .target-row { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
        .target-label { font-size: 10px; color: #4a5568; flex-shrink: 0; }
        .target-input { background: #0f1318; border: 1px solid #1e2530; border-radius: 8px;
          padding: 5px 10px; color: #e2e8f0; font-family: 'DM Mono', monospace; font-size: 12px;
          width: 90px; outline: none; }
        .target-input:focus { border-color: #4ade8044; }

        .result-actions { display: flex; gap: 8px; margin-top: 2px; }
        .view-btn { background: #0f1318; border: 1px solid #1e2530; border-radius: 8px;
          padding: 6px 12px; color: #94a3b8; font-family: 'DM Mono', monospace; font-size: 11px;
          text-decoration: none; transition: all .2s; white-space: nowrap; }
        .view-btn:hover { border-color: #4ade8044; color: #4ade80; }
        .remove-btn { background: transparent; border: 1px solid #1e2530; border-radius: 8px;
          padding: 6px 10px; color: #334155; font-size: 12px; cursor: pointer;
          transition: all .2s; margin-left: auto; }
        .remove-btn:hover { border-color: #f8714444; color: #f87174; }

        /* results header */
        .results-header { display: flex; align-items: baseline; justify-content: space-between;
          margin-bottom: 12px; }
        .results-query { font-family: 'Syne', sans-serif; font-weight: 700; font-size: 15px; color: #f1f5f9; }
        .results-total { font-size: 11px; color: #4a5568; }

        /* stats bar */
        .stats-bar { display: flex; background: #0c1015; border: 1px solid #1a2030;
          border-radius: 12px; padding: 14px 20px; margin-bottom: 14px; align-items: center; }
        .stat { flex: 1; text-align: center; display: flex; flex-direction: column; gap: 4px; }
        .stat-label { font-size: 9px; color: #4a5568; letter-spacing: 2px; text-transform: uppercase; }
        .stat-val { font-family: 'Syne', sans-serif; font-weight: 700; font-size: 15px; color: #f1f5f9; }
        .stat-val.green { color: #4ade80; }
        .stat-val.red   { color: #f87171; }
        .stat-div { width: 1px; background: #1a2030; margin: 0 8px; align-self: stretch; }

        /* empty / loading */
        .empty { text-align: center; padding: 60px 20px; color: #2d3748; }
        .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: .4; }
        .empty p { font-size: 14px; line-height: 2; }
        .empty-sub { font-size: 12px; color: #1e2730; }
        .loading { text-align: center; padding: 60px 20px; }
        .pulse { font-size: 36px; animation: pulse 1s infinite; }
        .loading p { margin-top: 14px; font-size: 13px; color: #4a5568; }
        .error-box { background: #1a0808; border: 1px solid #f8714433; border-radius: 12px;
          padding: 16px; color: #f87171; font-size: 13px; }

        /* toast */
        .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #0c1015; border: 1px solid #4ade8044; border-radius: 12px;
          padding: 12px 24px; color: #4ade80; font-size: 13px; z-index: 999;
          white-space: pre-line; text-align: center;
          animation: slideDown .3s ease; box-shadow: 0 8px 32px #00000066; }

        /* spin */
        .spin { display: inline-block; animation: spin 1s linear infinite; }

        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes slideDown { from{opacity:0;transform:translateX(-50%) translateY(-10px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
      `}</style>
    </>
  )
}

// ── AddButton com campo de preço alvo inline ─────────────────
function AddButton({ inWatch, onAdd }) {
  const [open,   setOpen]   = useState(false)
  const [target, setTarget] = useState('')

  if (inWatch) return <span style={{ fontSize: 11, color: '#4ade80', padding: '6px 10px' }}>✓ Monitorando</span>

  if (!open) return (
    <button onClick={() => setOpen(true)}
      style={{ background: '#052e16', border: '1px solid #4ade8033', borderRadius: 8,
        padding: '6px 14px', color: '#4ade80', fontFamily: 'DM Mono, monospace',
        fontSize: 11, cursor: 'pointer' }}>
      + Monitorar
    </button>
  )

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="number"
        placeholder="Preço alvo (opcional)"
        value={target}
        onChange={e => setTarget(e.target.value)}
        autoFocus
        style={{ background: '#0f1318', border: '1px solid #4ade8044', borderRadius: 8,
          padding: '5px 10px', color: '#e2e8f0', fontFamily: 'DM Mono, monospace',
          fontSize: 11, width: 160, outline: 'none' }}
      />
      <button onClick={() => { onAdd(target ? parseFloat(target) : null); setOpen(false) }}
        style={{ background: '#4ade80', border: 'none', borderRadius: 8,
          padding: '6px 12px', color: '#052e16', fontFamily: 'Syne, sans-serif',
          fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
        ✓
      </button>
      <button onClick={() => setOpen(false)}
        style={{ background: 'transparent', border: '1px solid #1e2530', borderRadius: 8,
          padding: '6px 10px', color: '#4a5568', fontSize: 11, cursor: 'pointer' }}>
        ✕
      </button>
    </div>
  )
}
