import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Canal, Entregador, FormaPagamento, Maquina, MaquinaTaxa } from './types'

interface Cadastros {
  canais: Canal[]
  formas: FormaPagamento[]
  maquinas: Maquina[]
  taxas: MaquinaTaxa[]
  entregadores: Entregador[]
  carregado: boolean
  recarregar: () => Promise<void>
  nomeCanal: (id: number | null | undefined) => string
  nomeForma: (id: number | null | undefined) => string
  nomeMaquina: (id: number | null | undefined) => string
  nomeEntregador: (id: number | null | undefined) => string
  /** Taxa vigente para máquina+forma numa data (mesma regra do banco) */
  taxaVigente: (maquinaId: number | null, formaId: number | null, data: string) => MaquinaTaxa | null
}

const Ctx = createContext<Cadastros | null>(null)

export function CadastrosProvider({ children }: { children: ReactNode }) {
  const [canais, setCanais] = useState<Canal[]>([])
  const [formas, setFormas] = useState<FormaPagamento[]>([])
  const [maquinas, setMaquinas] = useState<Maquina[]>([])
  const [taxas, setTaxas] = useState<MaquinaTaxa[]>([])
  const [entregadores, setEntregadores] = useState<Entregador[]>([])
  const [carregado, setCarregado] = useState(false)

  const recarregar = useCallback(async () => {
    const [c, f, m, t, e] = await Promise.all([
      supabase.from('canais').select('*').order('ordem').order('nome'),
      supabase.from('formas_pagamento').select('*').order('ordem').order('nome'),
      supabase.from('maquinas').select('*').order('nome'),
      supabase.from('maquina_taxas').select('*').order('vigente_desde', { ascending: false }),
      supabase.from('entregadores').select('*').order('nome'),
    ])
    setCanais((c.data as Canal[]) ?? [])
    setFormas((f.data as FormaPagamento[]) ?? [])
    setMaquinas((m.data as Maquina[]) ?? [])
    setTaxas((t.data as MaquinaTaxa[]) ?? [])
    setEntregadores((e.data as Entregador[]) ?? [])
    setCarregado(true)
  }, [])

  useEffect(() => {
    recarregar()
  }, [recarregar])

  const valor = useMemo<Cadastros>(() => {
    const por = <T extends { id: number; nome: string }>(lista: T[]) => {
      const mapa = new Map(lista.map((x) => [x.id, x.nome]))
      return (id: number | null | undefined) => (id == null ? '—' : mapa.get(id) ?? '?')
    }
    return {
      canais, formas, maquinas, taxas, entregadores, carregado, recarregar,
      nomeCanal: por(canais),
      nomeForma: por(formas),
      nomeMaquina: por(maquinas),
      nomeEntregador: por(entregadores),
      taxaVigente: (maquinaId, formaId, data) => {
        if (maquinaId == null || formaId == null) return null
        return (
          taxas
            .filter((t) => t.maquina_id === maquinaId && t.forma_pagamento_id === formaId && t.vigente_desde <= data)
            .sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))[0] ?? null
        )
      },
    }
  }, [canais, formas, maquinas, taxas, entregadores, carregado, recarregar])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useCadastros() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useCadastros fora do provider')
  return c
}
