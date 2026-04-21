// /pages/api/search.js
// Busca produtos no Mercado Livre usando a API pública oficial
// Não precisa de chave — é aberta para consultas de busca

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { q, limit = 5 } = req.query

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Query muito curta' })
  }

  try {
    // API pública do Mercado Livre — sem autenticação necessária
    const mlUrl = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(q)}&limit=${limit}&sort=price_asc`

    const response = await fetch(mlUrl, {
      headers: {
        'User-Agent': 'PriceHawk/1.0',
      },
    })

    if (!response.ok) {
      throw new Error(`ML API error: ${response.status}`)
    }

    const data = await response.json()

    // Formata os resultados
    const results = (data.results || []).map(item => ({
      id:          item.id,
      title:       item.title,
      price:       item.price,
      currency:    item.currency_id,
      condition:   item.condition === 'new' ? 'Novo' : 'Usado',
      seller:      item.seller?.nickname || 'Vendedor',
      link:        item.permalink,
      thumbnail:   item.thumbnail?.replace('http://', 'https://'),
      installments: item.installments
        ? `${item.installments.quantity}x R$ ${(item.installments.amount).toFixed(2).replace('.', ',')}`
        : null,
      freeShipping: item.shipping?.free_shipping || false,
      available:   item.available_quantity || 0,
      sold:        item.sold_quantity || 0,
    }))

    // Estatísticas para análise de preço
    const prices   = results.map(r => r.price)
    const minPrice = prices.length ? Math.min(...prices) : 0
    const maxPrice = prices.length ? Math.max(...prices) : 0
    const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0

    return res.status(200).json({
      query:    q,
      total:    data.paging?.total || 0,
      results,
      stats: {
        min: minPrice,
        max: maxPrice,
        avg: Math.round(avgPrice * 100) / 100,
      },
    })
  } catch (err) {
    console.error('Search error:', err)
    return res.status(500).json({ error: 'Erro ao buscar preços. Tente novamente.' })
  }
}
