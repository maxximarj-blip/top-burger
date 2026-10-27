import type { Modalidade, Papel, StatusComanda, TipoMovimento } from './types'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const numero = new Intl.NumberFormat('pt-BR')
const percentual = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const brl = (v: number | string | null | undefined) => moeda.format(Number(v ?? 0))
export const num = (v: number | string | null | undefined) => numero.format(Number(v ?? 0))
export const pct = (v: number | string | null | undefined) => percentual.format(Number(v ?? 0))

/** "2026-10-27" -> "27/10/2026" */
export function dataBR(iso: string | null | undefined, curta = false) {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  return curta ? `${d}/${m}` : `${d}/${m}/${a}`
}

export function dataHoraBR(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
}

/** Hoje no fuso de São Paulo, em ISO (yyyy-mm-dd) */
export function hoje(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function inicioMes(iso: string, deslocamento = 0): string {
  const [a, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + deslocamento, 1, 12))
  return d.toISOString().slice(0, 10)
}

export function fimMes(iso: string, deslocamento = 0): string {
  return somarDias(inicioMes(iso, deslocamento + 1), -1)
}

export function diaSemana(iso: string) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })
}

/** Lê número digitado no padrão BR ("1.234,56" ou "12,5") */
export function lerValor(txt: string): number {
  const limpo = txt.replace(/[^\d,.-]/g, '')
  if (!limpo) return 0
  const n = limpo.includes(',') ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export const valorParaCampo = (v: number | null | undefined) =>
  v == null || Number(v) === 0 ? '' : Number(v).toFixed(2).replace('.', ',')

export const NOME_MODALIDADE: Record<Modalidade, string> = {
  delivery_proprio: 'Delivery próprio',
  delivery_plataforma: 'Entrega plataforma',
  retirada: 'Retirada',
  mesa: 'Mesa',
}

export const NOME_STATUS: Record<StatusComanda, string> = {
  recebido: 'Recebido',
  pendente: 'Pendente',
  cancelado: 'Cancelado',
}

export const NOME_PAPEL: Record<Papel, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  caixa: 'Caixa',
}

export const NOME_MOVIMENTO: Record<TipoMovimento, string> = {
  suprimento: 'Suprimento (entrada)',
  sangria: 'Sangria (retirada)',
  despesa: 'Despesa paga no caixa',
  pagamento_entregador: 'Pagamento de entregador',
}

export const DIAS_SEMANA = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

/** Gera e baixa um CSV (separador ; e vírgula decimal, abre direto no Excel BR) */
export function baixarCsv(nome: string, linhas: (string | number | null | undefined)[][]) {
  const conteudo = linhas
    .map((l) =>
      l
        .map((c) => {
          if (c == null) return ''
          if (typeof c === 'number') return String(c).replace('.', ',')
          const s = String(c)
          return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(';'),
    )
    .join('\r\n')
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nome
  a.click()
  URL.revokeObjectURL(a.href)
}
