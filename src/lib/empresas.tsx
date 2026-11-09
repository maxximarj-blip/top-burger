import { useEffect, useSyncExternalStore } from 'react'
import { Selecao } from '../components/ui'
import { supabase } from './supabase'

export interface Empresa {
  id: number
  nome: string
  razao_social: string | null
  cnpj: string
  titular_nome: string | null
  telefone: string | null
  email: string | null
  controla_comandas: boolean
  ativo: boolean
  ordem: number
}

// ---- lista compartilhada (carrega uma vez, todas as telas leem a mesma)
let lista: Empresa[] = []
let carregando: Promise<void> | null = null
const ouvintes = new Set<() => void>()

export async function recarregarEmpresas() {
  const { data } = await supabase.from('empresas').select('id, nome, razao_social, cnpj, titular_nome, telefone, email, controla_comandas, ativo, ordem').order('ordem').order('id')
  lista = (data as Empresa[]) ?? []
  ouvintes.forEach((f) => f())
}

export function useEmpresas() {
  useEffect(() => {
    if (!carregando) carregando = recarregarEmpresas()
  }, [])
  const todas = useSyncExternalStore((f) => { ouvintes.add(f); return () => ouvintes.delete(f) }, () => lista)
  const ativas = todas.filter((e) => e.ativo)
  return {
    todas,
    ativas,
    varias: ativas.length > 1,
    nome: (id: number | null | undefined) => todas.find((e) => e.id === id)?.nome ?? '',
    padrao: ativas[0]?.id ?? 0,
  }
}

// ---- última empresa usada nos lançamentos (para já vir escolhida)
const CHAVE = 'tb_empresa_lancamento'
export function empresaPreferida(ativas: Empresa[]): number {
  let id = 0
  try { id = Number(localStorage.getItem(CHAVE)) || 0 } catch { /* sem storage */ }
  return ativas.find((e) => e.id === id)?.id ?? ativas[0]?.id ?? 0
}
export function lembrarEmpresa(id: number) {
  try { localStorage.setItem(CHAVE, String(id)) } catch { /* sem storage */ }
}

/** Seletor de CNPJ. Com `todas`, inclui a opção 0 = todas as empresas. */
export function SeletorEmpresa({ valor, aoMudar, todas, rotuloTodas = 'Todas as empresas', ...resto }: {
  valor: number; aoMudar: (id: number) => void; todas?: boolean; rotuloTodas?: string
} & { 'aria-label'?: string; className?: string }) {
  const { ativas, todas: lista } = useEmpresas()
  const opcoes = lista.filter((e) => e.ativo || e.id === valor)
  return (
    <Selecao value={valor} onChange={(e) => aoMudar(Number(e.target.value))} aria-label={resto['aria-label'] ?? 'Empresa'} className={resto.className ?? 'entrada'}>
      {todas && <option value={0}>{rotuloTodas}</option>}
      {!todas && !ativas.some((e) => e.id === valor) && <option value={0}>Escolha a empresa…</option>}
      {opcoes.map((e) => <option key={e.id} value={e.id}>{e.nome} · {e.cnpj}</option>)}
    </Selecao>
  )
}

/** Etiqueta pequena com o nome da empresa (só aparece quando há mais de um CNPJ) */
export function TagEmpresa({ id }: { id: number | null | undefined }) {
  const { varias, nome, todas } = useEmpresas()
  if (!varias || !id) return null
  const i = Math.max(0, todas.findIndex((e) => e.id === id))
  return <span className={`tag-empresa tag-empresa-${i % 4}`}>{nome(id)}</span>
}
