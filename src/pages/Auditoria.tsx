import { Fragment, useCallback, useEffect, useState } from 'react'
import { Alerta, Botao, Cabecalho, Cartao, Carregando, Selecao, Selo, Vazio } from '../components/ui'
import { dataHoraBR } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Auditoria as Registro } from '../lib/types'

const TABELAS: Record<string, string> = {
  comandas: 'Comandas', movimentos_caixa: 'Movimentos de caixa', fechamentos: 'Fechamentos', perfis: 'Usuários',
  canais: 'Canais', formas_pagamento: 'Formas de pagamento', maquinas: 'Máquinas', maquina_taxas: 'Taxas', entregadores: 'Entregadores',
  produtos: 'Produtos', insumos: 'Insumos', clientes: 'Clientes', fornecedores: 'Fornecedores', loja: 'Endereço da loja',
  compras: 'Compras', compra_itens: 'Itens de compra',
}
const ACOES = { INSERT: ['Criou', 'ok'], UPDATE: ['Alterou', 'info'], DELETE: ['Excluiu', 'erro'] } as const
const IGNORAR = new Set(['atualizado_em', 'atualizado_por', 'criado_em', 'resumo', 'conferido_em', 'conferido_por', 'fechado_por', 'valor_itens'])
const POR_PAGINA = 100

function descrever(r: Registro) {
  const d = (r.depois ?? r.antes ?? {}) as Record<string, unknown>
  if (r.tabela === 'comandas') return `Comanda ${d.numero} de ${String(d.data).split('-').reverse().join('/')}`
  if (r.tabela === 'compras') return `Compra #${d.id} de ${String(d.data).split('-').reverse().join('/')} — R$ ${Number(d.total ?? 0).toFixed(2).replace('.', ',')}`
  if (r.tabela === 'compra_itens') return `${d.descricao} (compra #${d.compra_id})`
  if (r.tabela === 'fechamentos') return `Caixa de ${String(d.data).split('-').reverse().join('/')}`
  return String(d.nome ?? d.descricao ?? `#${r.registro_id}`)
}

function mudancas(r: Registro) {
  if (r.acao !== 'UPDATE' || !r.antes || !r.depois) return []
  return Object.keys(r.depois).filter((k) => !IGNORAR.has(k) && JSON.stringify(r.antes![k]) !== JSON.stringify(r.depois![k]))
}

const fmt = (v: unknown) => (v == null || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function Auditoria() {
  const [lista, setLista] = useState<Registro[]>([])
  const [tabela, setTabela] = useState('')
  const [pagina, setPagina] = useState(0)
  const [aberto, setAberto] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true)
    let q = supabase.from('auditoria').select('*').order('em', { ascending: false }).range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1)
    if (tabela) q = q.eq('tabela', tabela)
    const { data, error } = await q
    if (error) setErro(mensagemErro(error))
    else setLista((data as Registro[]) ?? [])
    setCarregando(false)
  }, [tabela, pagina])

  useEffect(() => {
    carregar()
  }, [carregar])

  return (
    <div className="pagina">
      <Cabecalho titulo="Auditoria" subtitulo="Tudo que foi criado, alterado ou excluído, por quem e quando"
        acoes={
          <Selecao value={tabela} onChange={(e) => { setTabela(e.target.value); setPagina(0) }}>
            <option value="">Tudo</option>
            {Object.entries(TABELAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Selecao>
        } />
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <Cartao className="sem-padding">
        {carregando ? <Carregando /> : lista.length === 0 ? <Vazio>Nenhum registro.</Vazio> : (
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>O quê</th><th>Campos</th></tr></thead>
            <tbody>
              {lista.map((r) => {
                const campos = mudancas(r)
                const [rotulo, tom] = ACOES[r.acao]
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => setAberto(aberto === r.id ? null : r.id)}>
                      <td>{dataHoraBR(r.em)}</td>
                      <td>{r.usuario ?? 'sistema'}</td>
                      <td><Selo tom={tom}>{rotulo}</Selo></td>
                      <td>{TABELAS[r.tabela] ?? r.tabela} · {descrever(r)}</td>
                      <td className="campo-dica">{campos.join(', ')}</td>
                    </tr>
                    {aberto === r.id && (
                      <tr className="detalhe">
                        <td colSpan={5}>
                          {r.acao === 'UPDATE' ? (
                            <table className="tabela tabela-mini">
                              <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
                              <tbody>{campos.map((k) => <tr key={k}><td>{k}</td><td className="neg">{fmt(r.antes?.[k])}</td><td className="pos">{fmt(r.depois?.[k])}</td></tr>)}</tbody>
                            </table>
                          ) : <pre>{JSON.stringify(r.depois ?? r.antes, null, 2)}</pre>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </Cartao>
      <div className="paginacao">
        <Botao disabled={pagina === 0} onClick={() => setPagina(pagina - 1)}>← Mais recentes</Botao>
        <span>Página {pagina + 1}</span>
        <Botao disabled={lista.length < POR_PAGINA} onClick={() => setPagina(pagina + 1)}>Mais antigos →</Botao>
      </div>
    </div>
  )
}
