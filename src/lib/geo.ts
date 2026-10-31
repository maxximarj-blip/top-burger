/**
 * Localização de clientes no mapa.
 * - CEP → endereço: ViaCEP (grátis, sem chave)
 * - endereço → posição: Nominatim / OpenStreetMap (grátis, sem chave, 1 busca por segundo)
 */

export type Loja = {
  id: number
  nome: string
  endereco: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  cep: string | null
  latitude: number | null
  longitude: number | null
}

export type EnderecoBusca = {
  endereco?: unknown
  bairro?: unknown
  cidade?: unknown
  uf?: unknown
  cep?: unknown
  [outro: string]: unknown
}

export type Precisao = 'endereco' | 'bairro' | 'manual'
export interface Posicao { lat: number; lng: number; precisao: Precisao }

const txt = (v: unknown) => String(v ?? '').trim()
export const soDigitosCep = (v: unknown) => txt(v).replace(/\D/g, '')
export const formatarCep = (v: unknown) => {
  const d = soDigitosCep(v)
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : txt(v)
}

/** Texto que identifica o endereço (muda → precisa buscar a posição de novo) */
export function chaveEndereco(e: EnderecoBusca, padrao?: EnderecoBusca | null) {
  const cidade = txt(e.cidade) || txt(padrao?.cidade)
  const uf = txt(e.uf) || txt(padrao?.uf)
  return [txt(e.endereco), txt(e.bairro), cidade, uf, soDigitosCep(e.cep)]
    .map((s) => s.toLowerCase().replace(/\s+/g, ' '))
    .join('|')
}

export function temEndereco(e: EnderecoBusca) {
  return Boolean(txt(e.endereco) || txt(e.bairro) || soDigitosCep(e.cep).length === 8)
}

// ---------------------------------------------------------------- CEP
export async function buscarCep(cep: unknown): Promise<{ endereco: string; bairro: string; cidade: string; uf: string } | null> {
  const d = soDigitosCep(cep)
  if (d.length !== 8) return null
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
    if (!r.ok) return null
    const j = await r.json()
    if (j.erro) return null
    return { endereco: j.logradouro ?? '', bairro: j.bairro ?? '', cidade: j.localidade ?? '', uf: j.uf ?? '' }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- Nominatim
let ultimaBusca = 0
async function esperarVez() {
  // regra de uso do OpenStreetMap: no máximo 1 busca por segundo
  const agora = Date.now()
  const espera = Math.max(0, ultimaBusca + 1100 - agora)
  ultimaBusca = agora + espera
  if (espera) await new Promise((r) => setTimeout(r, espera))
}

async function nominatim(params: Record<string, string>) {
  await esperarVez()
  const qs = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', 'accept-language': 'pt-BR', ...params })
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${qs}`)
  if (!r.ok) throw new Error(`busca de endereço falhou (${r.status})`)
  const j = (await r.json()) as { lat: string; lon: string }[]
  return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null
}

/**
 * Acha a posição do endereço. Tenta pela rua; se não achar, usa o centro do bairro (aproximado).
 * Sem cidade no cadastro, usa a cidade da loja.
 */
export async function geocodificar(e: EnderecoBusca, padrao?: EnderecoBusca | null): Promise<Posicao | null> {
  const rua = txt(e.endereco)
  const bairro = txt(e.bairro)
  const cidade = txt(e.cidade) || txt(padrao?.cidade)
  const uf = txt(e.uf) || txt(padrao?.uf)
  const cep = soDigitosCep(e.cep)

  if (rua && cidade) {
    const p = await nominatim({ street: rua, city: cidade, ...(uf ? { state: uf } : {}), country: 'Brasil' })
    if (p) return { ...p, precisao: 'endereco' }
    const q = await nominatim({ q: [rua, bairro, cidade, uf].filter(Boolean).join(', ') })
    if (q) return { ...q, precisao: 'endereco' }
  }
  if (cep.length === 8) {
    const p = await nominatim({ postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}`, country: 'Brasil' })
    if (p) return { ...p, precisao: 'bairro' }
  }
  if (bairro && cidade) {
    const p = await nominatim({ q: [bairro, cidade, uf].filter(Boolean).join(', ') })
    if (p) return { ...p, precisao: 'bairro' }
  }
  return null
}

// ---------------------------------------------------------------- recência
export type Recencia = 'verde' | 'amarelo' | 'vermelho' | 'sem'
export const CORES: Record<Recencia, string> = { verde: '#2f9e44', amarelo: '#f2b705', vermelho: '#d9381e', sem: '#8a8a8a' }
export const ROTULOS: Record<Recencia, string> = {
  verde: 'Comprou nos últimos 30 dias',
  amarelo: 'Última compra entre 31 e 90 dias',
  vermelho: 'Sem comprar há mais de 90 dias',
  sem: 'Nunca comprou',
}

export function diasDesde(data: unknown, hojeIso: string): number | null {
  if (!data) return null
  const a = new Date(String(data).slice(0, 10) + 'T12:00:00')
  const b = new Date(hojeIso + 'T12:00:00')
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function recencia(ultimaCompra: unknown, hojeIso: string): Recencia {
  const d = diasDesde(ultimaCompra, hojeIso)
  if (d == null) return 'sem'
  if (d <= 30) return 'verde'
  if (d <= 90) return 'amarelo'
  return 'vermelho'
}
