/**
 * Leitura de notas fiscais.
 * - XML da NF-e (modelo 55) e NFC-e (modelo 65), layout 4.00 — lido no navegador.
 * - Resultado da leitura por foto/PDF (função ler-nota) convertido para o mesmo formato.
 */

export interface ItemNota {
  codigo: string | null
  descricao: string
  unidade: string
  quantidade: number
  valor_unitario: number
  valor_total: number
}

export interface NotaLida {
  origem: 'xml' | 'foto'
  arquivo: string
  chave: string | null
  modelo: string | null // 55 = NF-e, 65 = NFC-e
  numero: string | null
  serie: string | null
  data: string // yyyy-mm-dd
  emitente: { documento: string | null; nome: string; fantasia: string | null }
  itens: ItemNota[]
  valor_produtos: number
  frete: number // inclui seguro, outras despesas e impostos destacados (ST, IPI)
  desconto: number
  total: number
  vencimentos: { numero: string | null; data: string; valor: number }[]
  forma_pagamento: string | null
  avisos: string[]
}

const FORMA_TPAG: Record<string, string> = {
  '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja',
  '10': 'Vale-alimentação', '11': 'Vale-refeição', '12': 'Vale-presente', '13': 'Vale-combustível',
  '15': 'Boleto', '16': 'Depósito', '17': 'Pix', '18': 'Transferência', '19': 'Fidelidade', '90': 'Sem pagamento', '99': 'Outros',
}

const n = (v: string | null | undefined) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const r2 = (v: number) => Math.round(v * 100) / 100

/** Primeiro elemento com o nome (ignora namespace) dentro de `el` */
function tag(el: Element | Document | null | undefined, nome: string): Element | null {
  if (!el) return null
  return el.getElementsByTagNameNS('*', nome)[0] ?? el.getElementsByTagName(nome)[0] ?? null
}
function tags(el: Element | Document | null | undefined, nome: string): Element[] {
  if (!el) return []
  const a = Array.from(el.getElementsByTagNameNS('*', nome))
  return a.length ? a : Array.from(el.getElementsByTagName(nome))
}
function txt(el: Element | Document | null | undefined, ...caminho: string[]): string | null {
  let atual: Element | Document | null | undefined = el
  for (const p of caminho) atual = tag(atual, p)
  const t = atual?.textContent?.trim()
  return t ? t : null
}

export function lerXmlNfe(conteudo: string, arquivo: string): NotaLida {
  const doc = new DOMParser().parseFromString(conteudo.replace(/^﻿/, ''), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`${arquivo}: o arquivo não é um XML válido.`)

  const inf = tag(doc, 'infNFe')
  if (!inf) {
    if (tag(doc, 'resNFe')) throw new Error(`${arquivo}: é um resumo de NF-e (sem itens). Baixe o XML completo da nota.`)
    if (tag(doc, 'procEventoNFe') || tag(doc, 'evento')) throw new Error(`${arquivo}: é um evento (cancelamento/carta de correção), não a nota.`)
    if (tag(doc, 'infCte')) throw new Error(`${arquivo}: é um CT-e (conhecimento de frete), não uma nota de compra.`)
    throw new Error(`${arquivo}: não encontrei uma NF-e/NFC-e neste XML.`)
  }

  const avisos: string[] = []
  const chave = (inf.getAttribute('Id') ?? '').replace(/\D/g, '') || txt(doc, 'protNFe', 'chNFe')
  const ide = tag(inf, 'ide')
  const emit = tag(inf, 'emit')
  const dhEmi = txt(ide, 'dhEmi') ?? txt(ide, 'dEmi') ?? ''
  if (!tag(doc, 'protNFe')) avisos.push('XML sem protocolo de autorização da Sefaz — confira se a nota foi realmente autorizada.')

  const itens: ItemNota[] = tags(inf, 'det').map((det) => {
    const prod = tag(det, 'prod')
    const q = n(txt(prod, 'qCom'))
    const vProd = n(txt(prod, 'vProd'))
    return {
      codigo: txt(prod, 'cProd'),
      descricao: txt(prod, 'xProd') ?? 'Item',
      unidade: txt(prod, 'uCom') ?? 'UN',
      quantidade: q,
      valor_unitario: n(txt(prod, 'vUnCom')) || (q ? vProd / q : 0),
      valor_total: vProd,
    }
  })

  const tot = tag(tag(inf, 'total'), 'ICMSTot')
  const vProd = n(txt(tot, 'vProd')) || itens.reduce((s, i) => s + i.valor_total, 0)
  const vDesc = n(txt(tot, 'vDesc'))
  const vNF = n(txt(tot, 'vNF'))
  const freteNota = n(txt(tot, 'vFrete'))
  // tudo que soma no total além de produtos e frete (seguro, outras despesas, ST, IPI…)
  const acrescimos = r2(vNF - (vProd - vDesc + freteNota))
  const frete = r2(freteNota + Math.max(0, acrescimos))
  if (acrescimos > 0.009) avisos.push(`A nota tem R$ ${acrescimos.toFixed(2).replace('.', ',')} de impostos/outras despesas além dos produtos — somados no frete para o total bater.`)
  if (acrescimos < -0.009) avisos.push('O total da nota é menor que produtos − desconto + frete. Confira os valores.')

  const vencimentos = tags(tag(inf, 'cobr'), 'dup').map((d) => ({
    numero: txt(d, 'nDup'),
    data: (txt(d, 'dVenc') ?? '').slice(0, 10),
    valor: n(txt(d, 'vDup')),
  })).filter((d) => d.data)

  const tPag = txt(tag(inf, 'pag'), 'tPag')
  const fantasia = txt(emit, 'xFant')

  return {
    origem: 'xml',
    arquivo,
    chave: chave && chave.length === 44 ? chave : null,
    modelo: txt(ide, 'mod'),
    numero: txt(ide, 'nNF'),
    serie: txt(ide, 'serie'),
    data: dhEmi.slice(0, 10),
    emitente: { documento: txt(emit, 'CNPJ') ?? txt(emit, 'CPF'), nome: txt(emit, 'xNome') ?? 'Fornecedor', fantasia },
    itens,
    valor_produtos: r2(vProd),
    frete,
    desconto: r2(vDesc),
    total: r2(vNF || vProd - vDesc + frete),
    vencimentos,
    forma_pagamento: vencimentos.length ? 'Boleto' : tPag ? FORMA_TPAG[tPag] ?? null : null,
    avisos,
  }
}

/** Resposta da função ler-nota (IA) -> NotaLida */
export interface LeituraIA {
  legivel: boolean
  tipo_documento: string
  chave_acesso: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  emitente: { nome: string | null; nome_fantasia: string | null; cnpj_cpf: string | null }
  itens: { codigo: string | null; descricao: string; unidade: string | null; quantidade: number; valor_unitario: number; valor_total: number }[]
  valor_produtos: number | null
  frete: number | null
  desconto: number | null
  outras_despesas: number | null
  valor_total: number | null
  forma_pagamento: string | null
  vencimentos: { data: string; valor: number }[]
  observacoes: string | null
}

export function deLeituraIA(l: LeituraIA, arquivo: string, hojeIso: string): NotaLida {
  const avisos: string[] = ['Lida por inteligência artificial a partir da imagem: confira itens, quantidades e valores com a nota antes de lançar.']
  if (!l.legivel) avisos.push('A imagem ficou difícil de ler. Se puder, tire outra foto com boa luz e a nota inteira no quadro.')
  if (l.observacoes) avisos.push(l.observacoes)

  const itens: ItemNota[] = (l.itens ?? []).filter((i) => i.descricao && i.quantidade > 0).map((i) => {
    const total = i.valor_total || r2(i.quantidade * i.valor_unitario)
    const unit = i.valor_unitario || (i.quantidade ? total / i.quantidade : 0)
    if (Math.abs(r2(i.quantidade * unit) - total) > Math.max(0.05, total * 0.01))
      avisos.push(`“${i.descricao}”: quantidade × preço (${(i.quantidade * unit).toFixed(2)}) não bate com o total do item (${total.toFixed(2)}).`)
    return { codigo: i.codigo, descricao: i.descricao, unidade: i.unidade || 'UN', quantidade: i.quantidade, valor_unitario: unit, valor_total: total }
  })
  const soma = r2(itens.reduce((s, i) => s + i.valor_total, 0))
  const vProd = l.valor_produtos ?? soma
  const desconto = r2(l.desconto ?? 0)
  const frete = r2((l.frete ?? 0) + (l.outras_despesas ?? 0))
  const total = r2(l.valor_total ?? vProd - desconto + frete)
  if (l.valor_produtos != null && Math.abs(soma - l.valor_produtos) > 0.05)
    avisos.push(`A soma dos itens lidos (R$ ${soma.toFixed(2).replace('.', ',')}) é diferente do total de produtos da nota (R$ ${l.valor_produtos.toFixed(2).replace('.', ',')}). Pode faltar ou sobrar item.`)
  const chave = (l.chave_acesso ?? '').replace(/\D/g, '')
  const data = /^\d{4}-\d{2}-\d{2}$/.test(l.data_emissao ?? '') ? l.data_emissao! : hojeIso
  if (data === hojeIso && !l.data_emissao) avisos.push('Não consegui ler a data da nota — usei a data de hoje.')

  return {
    origem: 'foto',
    arquivo,
    chave: chave.length === 44 ? chave : null,
    modelo: l.tipo_documento === 'nfce_cupom' ? '65' : l.tipo_documento === 'nfe_danfe' ? '55' : null,
    numero: l.numero,
    serie: l.serie,
    data,
    emitente: { documento: (l.emitente?.cnpj_cpf ?? '').replace(/\D/g, '') || null, nome: l.emitente?.nome || 'Fornecedor', fantasia: l.emitente?.nome_fantasia ?? null },
    itens,
    valor_produtos: r2(vProd),
    frete,
    desconto,
    total,
    vencimentos: (l.vencimentos ?? []).filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.data)).map((v, k) => ({ numero: String(k + 1).padStart(3, '0'), data: v.data, valor: v.valor })),
    forma_pagamento: l.forma_pagamento,
    avisos,
  }
}

// ---------------------------------------------------------------------
// Casamento de itens da nota com os insumos
// ---------------------------------------------------------------------
export function normalizar(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

export function chaveMapa(item: ItemNota) {
  return item.codigo ? `c:${item.codigo.trim()}` : `d:${normalizar(item.descricao)}`
}

const IGNORAR = new Set(['de', 'da', 'do', 'com', 'c', 'cx', 'kg', 'un', 'und', 'unid', 'pct', 'pc', 'g', 'gr', 'ml', 'l', 'lt', 'fd', 'tipo', 'e', 'em', 'p', 'x', 'pt', 'sc', 'bd', 'mg', 'cm'])
const SINONIMOS: Record<string, string> = {
  refri: 'refrigerante', refrig: 'refrigerante', moida: 'moida', moido: 'moida', hamb: 'hamburguer', burger: 'hamburguer',
  mussarela: 'queijo', muzzarela: 'queijo', mucarela: 'queijo', cheddar: 'cheddar', fatiado: 'fatiado', agua: 'agua',
  embal: 'embalagem', emb: 'embalagem', saco: 'sacola', sacos: 'sacola', guard: 'guardanapo', oleo: 'oleo', batata: 'batata',
}

function tokens(s: string) {
  return normalizar(s).split(' ').filter((t) => t && !IGNORAR.has(t) && !/^\d+$/.test(t)).map((t) => SINONIMOS[t] ?? t)
}

const parecido = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)))

/** Nota de 0 a 1: quanto do nome do insumo aparece na descrição da nota */
export function similaridade(descricaoNota: string, nomeInsumo: string) {
  const tn = tokens(descricaoNota)
  const ti = tokens(nomeInsumo)
  if (!tn.length || !ti.length) return 0
  const achados = ti.filter((t) => tn.some((x) => parecido(x, t))).length
  const usados = tn.filter((x) => ti.some((t) => parecido(x, t))).length
  return (achados / ti.length) * 0.7 + (usados / tn.length) * 0.3
}

const UN: Record<string, string> = {
  un: 'un', und: 'un', unid: 'un', unidade: 'un', pc: 'un', pca: 'un', peca: 'un', pç: 'un', ud: 'un',
  kg: 'kg', kgs: 'kg', quilo: 'kg', g: 'g', gr: 'g', grs: 'g', l: 'L', lt: 'L', litro: 'L', ml: 'ml',
  pct: 'pct', pac: 'pct', pacote: 'pct', cx: 'cx', caixa: 'cx', fd: 'fardo', fardo: 'fardo',
}
export function unidadePadrao(u: string) {
  const k = normalizar(u).replace(/\s/g, '')
  return UN[k] ?? k
}

/**
 * Fator para converter a quantidade da nota na unidade do insumo.
 * Ex.: nota em CX com "CX 12" / "C/12" / "12X350ML" e insumo em un -> 12; nota em g e insumo em kg -> 0,001.
 */
export function sugerirFator(item: ItemNota, unidadeInsumo: string): { fator: number; certeza: boolean } {
  const un = unidadePadrao(item.unidade)
  const ui = unidadePadrao(unidadeInsumo)
  if (un === ui) return { fator: 1, certeza: true }
  if (un === 'g' && ui === 'kg') return { fator: 0.001, certeza: true }
  if (un === 'kg' && ui === 'g') return { fator: 1000, certeza: true }
  if (un === 'ml' && ui === 'L') return { fator: 0.001, certeza: true }
  if (un === 'L' && ui === 'ml') return { fator: 1000, certeza: true }
  const d = normalizar(item.descricao)
  const m = d.match(/\b(?:cx|fd|pct|c|com|caixa|fardo)\s*(\d{1,4})\b/) ?? d.match(/\b(\d{1,4})\s*x\s*\d/) ?? d.match(/\b(\d{1,4})\s*(?:un|und|unid)\b/)
  if (m && ['un', 'pct'].includes(ui)) return { fator: Number(m[1]), certeza: false }
  const kg = d.match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/)
  if (kg && ui === 'kg' && un !== 'kg') return { fator: Number(kg[1].replace(',', '.')), certeza: false }
  const gr = d.match(/\b(\d+(?:[.,]\d+)?)\s*(?:g|gr|grs)\b/)
  if (gr && ui === 'kg') return { fator: Number(gr[1].replace(',', '.')) / 1000, certeza: false }
  const lt = d.match(/\b(\d+(?:[.,]\d+)?)\s*(?:l|lt|litros?)\b/)
  if (lt && ui === 'L' && un !== 'L') return { fator: Number(lt[1].replace(',', '.')), certeza: false }
  const ml = d.match(/\b(\d+(?:[.,]\d+)?)\s*ml\b/)
  if (ml && ui === 'L') return { fator: Number(ml[1].replace(',', '.')) / 1000, certeza: false }
  return { fator: 1, certeza: false }
}

export function soDigitos(s: string | null | undefined) {
  return (s ?? '').replace(/\D/g, '')
}

export function formatarCnpjCpf(s: string | null | undefined) {
  const d = soDigitos(s)
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return s ?? ''
}

/** Reduz foto grande para enviar à leitura (economiza dados e custo) */
export async function prepararImagem(arquivo: File, maxLado = 2000): Promise<{ base64: string; tipo: string }> {
  if (arquivo.type === 'application/pdf') {
    return { base64: await paraBase64(arquivo), tipo: 'application/pdf' }
  }
  const bmp = await createImageBitmap(arquivo)
  const escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * escala)
  canvas.height = Math.round(bmp.height * escala)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob: Blob = await new Promise((ok) => canvas.toBlob((b) => ok(b!), 'image/jpeg', 0.85))
  return { base64: await paraBase64(blob), tipo: 'image/jpeg' }
}

function paraBase64(b: Blob): Promise<string> {
  return new Promise((ok, erro) => {
    const fr = new FileReader()
    fr.onload = () => ok(String(fr.result).split(',')[1] ?? '')
    fr.onerror = () => erro(fr.error)
    fr.readAsDataURL(b)
  })
}
