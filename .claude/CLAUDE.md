# CLAUDE.md — PriceHawk
# Estende: ~/.claude/CLAUDE.md (configuração global)
# Prioridade: este arquivo sobrescreve o global neste repositório

## Projeto

**Nome:** PriceHawk
**Propósito:** App web PWA que busca e monitora preços de produtos no Mercado Livre em tempo real
**Stage:** MVP / alpha

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14.2.3 + React 18 |
| Backend | Sem backend próprio — consome API pública do Mercado Livre diretamente |
| Banco de dados | Nenhum — estado persistido em localStorage (client-side only) |
| Cache | Nenhum ainda |
| Queue | Nenhuma |
| Infra / deploy | Vercel (free tier) |
| CI/CD | Deploy automático via Vercel + GitHub |

## Limitações conhecidas

- **Sem backend**: toda lógica roda no browser; dados monitorados somem se trocar de dispositivo
- **Sem auth**: app é completamente público e stateless por usuário
- **Mercado Livre API**: sem autenticação OAuth — usa apenas endpoints públicos (rate limit aplica)
- **localStorage**: sem sincronização entre dispositivos

## Paths relevantes

| O quê | Onde |
|---|---|
| Config Next.js | `next.config.js` |
| Config Vercel | `vercel.json` |
| Dependências | `package.json` |
| README / deploy guide | `README.md` |

## Estado do repositório (2026-04-21)

- **Atenção:** código-fonte não está commitado — existe apenas `PriceHawk Deploy.zip` na raiz
- Extrair e commitar o código é o próximo passo antes de qualquer desenvolvimento

## Skills ativas neste projeto

- `nextjs-react-expert`
- `frontend-design`
- `tailwind-patterns`
- `vercel-deployment`

## Notas de produção

- App é PWA — deve ser instalável via Safari no iPad ("Adicionar à Tela de Início")
- API do Mercado Livre é pública; qualquer request de preço real vai para `api.mercadolibre.com`
- Sem rate limiting próprio — se o uso escalar, precisará de um proxy backend
