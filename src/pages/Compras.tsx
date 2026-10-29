import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Alerta, Botao, Cabecalho, Campo, Cartao, Carregando, Entrada, Kpi, Modal, Selecao, Selo, useAvisos, Vazio } from '../components/ui'
import { useAuth } from '../lib/auth'
import { baixarCsv, brl, brlUnit, dataBR, dataHoraBR, fimMes, hoje, inicioMes, mesExtenso, num, pct, qtd, somarDias } from '../lib/format'
import { buscarTudo, mensagemErro, supabase } from '../lib/supabase'
import type { Compra, CompraItem, Fornecedor, Insumo, RelatorioCompras } from '../lib/types'
import { CompraForm, FORMAS_COMPRA } from './CompraForm'
import { ImportarNota } from './ImportarNota'
import { recarregarPendentes, useFilaNotas } from '../lib/filaNotas'

type Aba = 'lancamentos' | 'pagar' | 'relatorio'
const CORES = ['#e0912a', '#c8402a', '#5b7f3a', '#3f6e8c', '#8a5a9e', '#9c6b3c', '#4f8f86', '#b5874a', '#6d6d6d']

function useBase() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [insumos, setInsumos] = useState<Insumo[]>([])
  const recarregar = useCallback(async () => {
    const [f, i] = await Promise.all([
      supabase.from('fornecedores').select('id, nome, razao_social, documento, categoria, prazo_pagamento_dias, ativo').order('nome'),
      supabase.from('insumos').select('*').order('nome'),
    ])
    setFornecedores((f.data as Fornecedor[]) ?? [])
    setInsumos((i.data as Insumo[]) ?? [])
  }, [])
  useEffect(() => { recarregar() }, [recarregar])
  return { fornecedores, insumos, recarregar }
}

function nomeFornecedor(c: Compra, fs: Fornecedor[]) {
  return c.fornecedor_id ? fs.find((f) => f.id === c.fornecedor_id)?.nome ?? '?' : c.fornecedor_nome ?? '—'
}

function SeloStatus({ c }: { c: Compra }) {
  if (c.status === 'cancelada') return <Selo tom="neutro">Cancelada</Selo>
  if (c.status === 'paga') return <Selo tom="ok">Paga</Selo>
  if (c.vencimento && c.vencimento < hoje()) return <Selo tom="erro">Vencida {dataBR(c.vencimento, true)}</Selo>
  if (c.vencimento === hoje()) return <Selo tom="alerta">Vence hoje</Selo>
  return <Selo tom="alerta">A pagar · {dataBR(c.vencimento, true)}</Selo>
}

/** Navegação de mês: ‹ outubro de 2026 › */
function SeletorMes({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  return (
    <div className="seletor-dia nao-imprimir">
      <button type="button" className="btn btn-fantasma btn-icone" onClick={() => aoMudar(inicioMes(valor, -1))} aria-label="Mês anterior">‹</button>
      <strong className="mes-atual">{mesExtenso(valor)}</strong>
      <button type="button" className="btn btn-fantasma btn-icone" onClick={() => aoMudar(inicioMes(valor, 1))} aria-label="Próximo mês">›</button>
      {inicioMes(valor) !== inicioMes(hoje()) && <button type="button" className="btn btn-fantasma" onClick={() => aoMudar(inicioMes(hoje()))}>Mês atual</button>}
    </div>
  )
}

export function Compras() {
  const [aba, setAba] = useState<Aba>('lancamentos')
  const base = useBase()
  const [mes, setMes] = useState(inicioMes(hoje()))
  const [form, setForm] = useState<{ compra: Compra | null; itens: CompraItem[] } | null>(null)
  const [params, setParams] = useSearchParams()
  const importar = params.has('importar')
  const setImportar = (v: boolean) => setParams(v ? { importar: '1' } : {}, { replace: true })
  const filaNotas = useFilaNotas()
  useEffect(() => { recarregarPendentes() }, [])
  const notasPendentes = filaNotas.pendentes.length + filaNotas.lendo.length
  const [versao, setVersao] = useState(0)
  const [aPagar, setAPagar] = useState<Compra[]>([])

  const carregarAPagar = useCallback(async () => {
    const { data } = await supabase.from('compras').select('*').eq('status', 'a_pagar').order('vencimento')
    setAPagar((data as Compra[]) ?? [])
  }, [])
  useEffect(() => { carregarAPagar() }, [carregarAPagar, versao])

  const abrir = async (c: Compra | null) => {
    if (!c) return setForm({ compra: null, itens: [] })
    const { data } = await supabase.from('compra_itens').select('*').eq('compra_id', c.id).order('id')
    setForm({ compra: c, itens: (data as CompraItem[]) ?? [] })
  }

  const vencidas = aPagar.filter((c) => c.vencimento! < hoje())

  return (
    <div className="pagina">
      <Cabecalho
        titulo="Compras"
        subtitulo="Tudo que entra na casa: mercadoria, embalagem, serviço. Itens de insumo atualizam estoque e custo."
        acoes={
          <>
            <Botao onClick={() => setImportar(true)} className="nao-imprimir">
              📄 Importar nota (XML / foto){notasPendentes > 0 && <span className="contador contador-erro">{notasPendentes}</span>}
            </Botao>
            <Botao variante="primario" onClick={() => abrir(null)} className="nao-imprimir">+ Nova compra</Botao>
          </>
        }
      />

      {filaNotas.pendentes.length > 0 && !importar && (
        <Alerta tom="alerta">
          <strong>{filaNotas.pendentes.length}</strong> {filaNotas.pendentes.length === 1 ? 'nota lida aguardando' : 'notas lidas aguardando'} conferência
          ({filaNotas.pendentes.map((p) => p.emitente).filter(Boolean).slice(0, 3).join(', ')}).{' '}
          <button className="link" onClick={() => setImportar(true)}>Continuar conferência →</button>
        </Alerta>
      )}

      <div className="abas nao-imprimir">
        <button className={aba === 'lancamentos' ? 'ativo' : ''} onClick={() => setAba('lancamentos')}>Lançamentos</button>
        <button className={aba === 'pagar' ? 'ativo' : ''} onClick={() => setAba('pagar')}>
          Contas a pagar {aPagar.length > 0 && <span className={`contador ${vencidas.length ? 'contador-erro' : ''}`}>{aPagar.length}</span>}
        </button>
        <button className={aba === 'relatorio' ? 'ativo' : ''} onClick={() => setAba('relatorio')}>Relatório do mês</button>
      </div>

      {aba === 'lancamentos' && <Lancamentos mes={mes} setMes={setMes} fornecedores={base.fornecedores} abrir={abrir} versao={versao} />}
      {aba === 'pagar' && <ContasAPagar lista={aPagar} fornecedores={base.fornecedores} abrir={abrir} aoMudar={() => setVersao((v) => v + 1)} />}
      {aba === 'relatorio' && <Relatorio mes={mes} setMes={setMes} fornecedores={base.fornecedores} versao={versao} />}

      <ImportarNota
        aberto={importar}
        aoFechar={() => setImportar(false)}
        aoSalvar={() => { setVersao((v) => v + 1); base.recarregar() }}
        fornecedores={base.fornecedores}
        insumos={base.insumos}
      />

      <CompraForm
        aberto={!!form}
        compra={form?.compra ?? null}
        itensIniciais={form?.itens ?? []}
        fornecedores={base.fornecedores}
        insumos={base.insumos}
        aoFechar={() => setForm(null)}
        aoSalvar={() => { setVersao((v) => v + 1); base.recarregar() }}
      />
    </div>
  )
}

// =====================================================================
// Lançamentos
// =====================================================================
function Lancamentos({ mes, setMes, fornecedores, abrir, versao }: {
  mes: string; setMes: (m: string) => void; fornecedores: Fornecedor[]; abrir: (c: Compra) => void; versao: number
}) {
  const [lista, setLista] = useState<Compra[]>([])
  const [itens, setItens] = useState<Map<number, CompraItem[]>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [forn, setForn] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    ;(async () => {
      try {
        const cs = await buscarTudo<Compra>((de, ate) =>
          supabase.from('compras').select('*').gte('data', mes).lte('data', fimMes(mes)).order('data', { ascending: false }).order('id', { ascending: false }).range(de, ate))
        const mapa = new Map<number, CompraItem[]>()
        const ids = cs.map((c) => c.id)
        for (let i = 0; i < ids.length; i += 150) {
          const { data } = await supabase.from('compra_itens').select('*').in('compra_id', ids.slice(i, i + 150)).order('id')
          ;((data as CompraItem[]) ?? []).forEach((it) => mapa.set(it.compra_id, [...(mapa.get(it.compra_id) ?? []), it]))
        }
        if (!ativo) return
        setLista(cs)
        setItens(mapa)
        setErro(null)
      } catch (e) {
        if (ativo) setErro(mensagemErro(e))
      }
      if (ativo) setCarregando(false)
    })()
    return () => { ativo = false }
  }, [mes, versao])

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lista.filter((c) => {
      if (forn && nomeFornecedor(c, fornecedores) !== forn) return false
      if (status === 'vencida' ? !(c.status === 'a_pagar' && c.vencimento! < hoje()) : status && c.status !== status) return false
      if (t) {
        const alvo = [nomeFornecedor(c, fornecedores), c.numero_nota, c.observacao, brl(c.total), ...(itens.get(c.id) ?? []).map((i) => i.descricao)].join(' ').toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [lista, busca, forn, status, fornecedores, itens])

  const validas = filtradas.filter((c) => c.status !== 'cancelada')
  const soma = (f: (c: Compra) => boolean) => validas.filter(f).reduce((s, c) => s + Number(c.total), 0)
  const nomesForn = [...new Set(lista.map((c) => nomeFornecedor(c, fornecedores)))].sort()

  const exportar = () => {
    const linhas: (string | number | null)[][] = [['Compra', 'Data', 'Fornecedor', 'Nota', 'Status', 'Forma', 'Vencimento', 'Pago em', 'Item', 'Categoria', 'Qtd', 'Un.', 'Preço un.', 'Total item', 'Frete', 'Desconto', 'Total compra']]
    filtradas.forEach((c) => (itens.get(c.id) ?? []).forEach((i, k) => linhas.push([
      c.id, dataBR(c.data), nomeFornecedor(c, fornecedores), c.numero_nota, c.status, c.forma_pagamento, dataBR(c.vencimento), dataBR(c.data_pagamento),
      i.descricao, i.categoria, Number(i.quantidade), i.unidade, Number(i.valor_unitario), Number(i.valor_total),
      k === 0 ? Number(c.frete) : null, k === 0 ? Number(c.desconto) : null, k === 0 ? Number(c.total) : null,
    ])))
    baixarCsv(`compras_${mes.slice(0, 7)}.csv`, linhas)
  }

  return (
    <>
      <div className="barra-filtros">
        <SeletorMes valor={mes} aoMudar={setMes} />
        <Entrada className="entrada busca" placeholder="Buscar fornecedor, item, nota, valor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Selecao value={forn} onChange={(e) => setForn(e.target.value)}>
          <option value="">Todos os fornecedores</option>
          {nomesForn.map((n) => <option key={n}>{n}</option>)}
        </Selecao>
        <Selecao value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="paga">Pagas</option>
          <option value="a_pagar">A pagar</option>
          <option value="vencida">Vencidas</option>
          <option value="cancelada">Canceladas</option>
        </Selecao>
        <Botao onClick={exportar} disabled={!filtradas.length}>Exportar CSV</Botao>
      </div>

      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="kpis kpis-compactos">
        <div><span>Compras</span><strong>{num(validas.length)}</strong></div>
        <div><span>Total</span><strong>{brl(soma(() => true))}</strong></div>
        <div><span>Pagas</span><strong>{brl(soma((c) => c.status === 'paga'))}</strong></div>
        <div><span>A pagar</span><strong className={soma((c) => c.status === 'a_pagar') ? 'neg' : ''}>{brl(soma((c) => c.status === 'a_pagar'))}</strong></div>
      </div>

      <Cartao className="sem-padding">
        {carregando ? <Carregando /> : filtradas.length === 0 ? (
          <Vazio>{lista.length ? 'Nenhuma compra com esses filtros.' : `Nenhuma compra lançada em ${mesExtenso(mes)}.`}</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela tabela-clicavel">
              <thead>
                <tr><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Nota</th><th>Forma</th><th>Status</th><th className="n">Total</th></tr>
              </thead>
              <tbody>
                {filtradas.map((c) => {
                  const its = itens.get(c.id) ?? []
                  return (
                    <tr key={c.id} className={c.status === 'cancelada' ? 'cancelada' : ''} onClick={() => abrir(c)}>
                      <td>{dataBR(c.data)}<small className="sub">#{c.id}</small></td>
                      <td className="forte">{nomeFornecedor(c, fornecedores)}{!c.fornecedor_id && <small className="sub">avulso</small>}</td>
                      <td className="celula-itens">
                        {its.slice(0, 2).map((i) => `${qtd(i.quantidade)} ${i.unidade} ${i.descricao}`).join(' · ')}
                        {its.length > 2 && <small className="sub">+ {its.length - 2} {its.length - 2 === 1 ? 'item' : 'itens'}</small>}
                      </td>
                      <td>{c.numero_nota || <span className="tenue">—</span>}{c.origem !== 'manual' && <small className="sub"><Selo tom="info">{c.origem === 'xml' ? 'XML' : 'foto'}</Selo></small>}</td>
                      <td>{c.forma_pagamento || <span className="tenue">—</span>}</td>
                      <td><SeloStatus c={c} /></td>
                      <td className="n forte">{brl(c.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>
    </>
  )
}

// =====================================================================
// Contas a pagar
// =====================================================================
function ContasAPagar({ lista, fornecedores, abrir, aoMudar }: {
  lista: Compra[]; fornecedores: Fornecedor[]; abrir: (c: Compra) => void; aoMudar: () => void
}) {
  const { avisar } = useAvisos()
  const [pagando, setPagando] = useState<Compra | null>(null)
  const [dataPg, setDataPg] = useState(hoje())
  const [formaPg, setFormaPg] = useState('')
  const [salvando, setSalvando] = useState(false)
  const h = hoje()
  const em7 = somarDias(h, 7)

  const grupos: { titulo: string; tom: 'erro' | 'alerta' | 'neutro'; itens: Compra[] }[] = [
    { titulo: 'Vencidas', tom: 'erro', itens: lista.filter((c) => c.vencimento! < h) },
    { titulo: 'Vencem nos próximos 7 dias', tom: 'alerta', itens: lista.filter((c) => c.vencimento! >= h && c.vencimento! <= em7) },
    { titulo: 'Depois', tom: 'neutro', itens: lista.filter((c) => c.vencimento! > em7) },
  ]
  const soma = (cs: Compra[]) => cs.reduce((s, c) => s + Number(c.total), 0)

  const pagar = async () => {
    if (!pagando) return
    setSalvando(true)
    const { error } = await supabase.rpc('pagar_compra', { p_id: pagando.id, p_data: dataPg, p_forma: formaPg || null })
    setSalvando(false)
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar(`Pagamento de ${brl(pagando.total)} registrado.`)
    setPagando(null)
    aoMudar()
  }

  return (
    <>
      <div className="kpis">
        <Kpi destaque rotulo="Total a pagar" valor={brl(soma(lista))} detalhe={`${num(lista.length)} ${lista.length === 1 ? 'conta' : 'contas'}`} />
        <Kpi rotulo="Vencidas" valor={brl(soma(grupos[0].itens))} detalhe={`${grupos[0].itens.length} conta(s)`} />
        <Kpi rotulo="Próximos 7 dias" valor={brl(soma(grupos[1].itens))} detalhe={`${grupos[1].itens.length} conta(s)`} />
        <Kpi rotulo="Depois" valor={brl(soma(grupos[2].itens))} />
      </div>
      {grupos[0].itens.length > 0 && <Alerta tom="erro">Há <strong>{grupos[0].itens.length}</strong> conta(s) vencida(s). Pague ou ajuste o vencimento se já foi renegociado.</Alerta>}

      {lista.length === 0 ? <Cartao><Vazio>Nenhuma conta a pagar. 🎉</Vazio></Cartao> : grupos.filter((g) => g.itens.length).map((g) => (
        <Cartao key={g.titulo} className="sem-padding" titulo={<>{g.titulo} <Selo tom={g.tom === 'neutro' ? 'neutro' : g.tom}>{brl(soma(g.itens))}</Selo></>}>
          <table className="tabela tabela-clicavel">
            <thead><tr><th>Vencimento</th><th>Fornecedor</th><th>Compra</th><th>Forma prevista</th><th className="n">Valor</th><th /></tr></thead>
            <tbody>
              {g.itens.map((c) => (
                <tr key={c.id} onClick={() => abrir(c)}>
                  <td className="forte">{dataBR(c.vencimento)}<small className="sub">{c.vencimento! < h ? `${Math.round((Date.parse(h) - Date.parse(c.vencimento!)) / 864e5)} dia(s) de atraso` : c.vencimento === h ? 'hoje' : `em ${Math.round((Date.parse(c.vencimento!) - Date.parse(h)) / 864e5)} dia(s)`}</small></td>
                  <td>{nomeFornecedor(c, fornecedores)}{c.numero_nota && <small className="sub">NF {c.numero_nota}</small>}</td>
                  <td>#{c.id} de {dataBR(c.data, true)}</td>
                  <td>{c.forma_pagamento || '—'}</td>
                  <td className="n forte">{brl(c.total)}</td>
                  <td className="n" onClick={(e) => e.stopPropagation()}>
                    <Botao variante="primario" onClick={() => { setPagando(c); setDataPg(hoje()); setFormaPg(c.forma_pagamento ?? '') }}>Pagar</Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>
      ))}

      <Modal aberto={!!pagando} aoFechar={() => setPagando(null)} titulo="Registrar pagamento"
        rodape={<><Botao variante="fantasma" onClick={() => setPagando(null)}>Cancelar</Botao><Botao variante="primario" onClick={pagar} carregando={salvando}>Confirmar pagamento</Botao></>}>
        {pagando && (
          <>
            <p><strong>{nomeFornecedor(pagando, fornecedores)}</strong> — compra #{pagando.id}, vencimento {dataBR(pagando.vencimento)}</p>
            <p className="valor-pagar">{brl(pagando.total)}</p>
            <div className="grade-2">
              <Campo rotulo="Pago em"><Entrada type="date" value={dataPg} onChange={(e) => setDataPg(e.target.value)} /></Campo>
              <Campo rotulo="Forma">
                <Selecao value={formaPg} onChange={(e) => setFormaPg(e.target.value)}>
                  <option value="">—</option>
                  {FORMAS_COMPRA.map((f) => <option key={f}>{f}</option>)}
                </Selecao>
              </Campo>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}

// =====================================================================
// Relatório do mês
// =====================================================================
function Relatorio({ mes, setMes, fornecedores, versao }: { mes: string; setMes: (m: string) => void; fornecedores: Fornecedor[]; versao: number }) {
  const { perfil } = useAuth()
  const [r, setR] = useState<RelatorioCompras | null>(null)
  const [compras, setCompras] = useState<Compra[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const fim = fimMes(mes)

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([
      supabase.rpc('relatorio_compras', { p_inicio: mes, p_fim: fim }),
      supabase.from('compras').select('*').gte('data', mes).lte('data', fim).neq('status', 'cancelada').order('data').order('id'),
    ]).then(([rel, cs]) => {
      if (!ativo) return
      if (rel.error) setErro(mensagemErro(rel.error))
      else { setErro(null); setR(rel.data as RelatorioCompras) }
      setCompras((cs.data as Compra[]) ?? [])
      setCarregando(false)
    })
    return () => { ativo = false }
  }, [mes, fim, versao])

  if (carregando && !r) return <Carregando />
  if (erro) return <Alerta tom="erro">{erro}</Alerta>
  if (!r) return null
  const k = r.kpis
  const variacao = Number(k.periodo_anterior) ? (Number(k.total) - Number(k.periodo_anterior)) / Number(k.periodo_anterior) : null
  const peso = Number(k.faturamento) ? Number(k.total) / Number(k.faturamento) : null

  const exportarResumo = () => baixarCsv(`relatorio_compras_${mes.slice(0, 7)}.csv`, [
    [`Relatório de compras — ${mesExtenso(mes)}`],
    [],
    ['Total comprado', Number(k.total)], ['Compras', k.compras], ['Pago', Number(k.pago)], ['A pagar', Number(k.a_pagar)],
    ['Faturamento do mês', Number(k.faturamento)], ['Compras / faturamento', peso ?? ''], ['Mês anterior', Number(k.periodo_anterior)],
    [],
    ['Categoria', 'Total', '% do total'],
    ...r.por_categoria.map((c) => [c.categoria, Number(c.total), Number(c.total) / Number(k.total)]),
    [],
    ['Fornecedor', 'Compras', 'Total', 'A pagar'],
    ...r.por_fornecedor.map((f) => [f.fornecedor, f.compras, Number(f.total), Number(f.a_pagar ?? 0)]),
    [],
    ['Item', 'Categoria', 'Quantidade', 'Un.', 'Total', 'Preço médio', 'Menor preço', 'Maior preço'],
    ...r.por_insumo.map((i) => [i.insumo, i.categoria, Number(i.quantidade), i.unidade, Number(i.total), Number(i.preco_medio), Number(i.preco_min), Number(i.preco_max)]),
  ])

  return (
    <div className="relatorio">
      <div className="barra-filtros nao-imprimir">
        <SeletorMes valor={mes} aoMudar={setMes} />
        <span className="mr-auto" />
        <Botao onClick={exportarResumo}>Exportar CSV</Botao>
        <Botao variante="primario" onClick={() => window.print()}>Imprimir / salvar PDF</Botao>
      </div>

      <div className="so-impressao cabecalho-impressao">
        <div>
          <strong>Top Burguer</strong>
          <h2>Relatório de compras — {mesExtenso(mes)}</h2>
        </div>
        <span>Período {dataBR(mes)} a {dataBR(fim)}<br />Emitido em {dataHoraBR(new Date().toISOString())} por {perfil?.nome}</span>
      </div>

      {k.compras === 0 ? <Cartao><Vazio>Nenhuma compra lançada em {mesExtenso(mes)}.</Vazio></Cartao> : (
        <>
          <div className="kpis">
            <Kpi destaque rotulo="Total comprado" valor={brl(k.total)} detalhe={`${num(k.compras)} compras · ${num(k.fornecedores)} fornecedores`} />
            <Kpi rotulo="Compras ÷ faturamento" valor={peso != null ? pct(peso) : '—'} detalhe={`faturamento ${brl(k.faturamento)}`} />
            <Kpi rotulo="Comparado ao mês anterior" valor={variacao != null ? `${variacao > 0 ? '+' : ''}${pct(variacao)}` : '—'} detalhe={`mês anterior ${brl(k.periodo_anterior)}`} />
            <Kpi rotulo="Pago × a pagar" valor={brl(k.pago)} detalhe={<>a pagar <strong className={Number(k.a_pagar) ? 'neg' : ''}>{brl(k.a_pagar)}</strong>{k.vencidas ? ` · ${k.vencidas} vencida(s)` : ''}</>} />
          </div>

          <div className="grade-painel">
            <Cartao titulo="Por categoria">
              <ResponsiveContainer width="100%" height={Math.max(150, r.por_categoria.length * 32)}>
                <BarChart layout="vertical" data={r.por_categoria.map((c) => ({ ...c, total: Number(c.total) }))} margin={{ left: 10, right: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="categoria" width={120} tick={{ fontSize: 12, fill: 'var(--texto)' }} />
                  <Tooltip formatter={(v) => brl(Number(v))} contentStyle={{ background: 'var(--superficie)', border: '1px solid var(--linha)', borderRadius: 8 }} />
                  <Bar dataKey="total" name="Total" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {r.por_categoria.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <table className="tabela tabela-mini">
                <tbody>
                  {r.por_categoria.map((c, i) => (
                    <tr key={c.categoria}><td><span className="ponto" style={{ background: CORES[i % CORES.length] }} />{c.categoria}</td><td className="n">{brl(c.total)}</td><td className="n tenue">{pct(Number(c.total) / Number(k.total))}</td></tr>
                  ))}
                </tbody>
              </table>
            </Cartao>

            <Cartao titulo="Por fornecedor">
              <table className="tabela">
                <thead><tr><th>Fornecedor</th><th className="n">Compras</th><th className="n">Total</th><th className="n">%</th></tr></thead>
                <tbody>
                  {r.por_fornecedor.map((f) => (
                    <tr key={f.fornecedor}>
                      <td>{f.fornecedor}{Number(f.a_pagar) > 0 && <small className="sub neg">a pagar {brl(f.a_pagar)}</small>}</td>
                      <td className="n">{f.compras}</td><td className="n">{brl(f.total)}</td><td className="n tenue">{pct(Number(f.total) / Number(k.total))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td className="n">{k.compras}</td><td className="n">{brl(k.total)}</td><td /></tr></tfoot>
              </table>
            </Cartao>

            <Cartao titulo="Compras por dia" className="span-2 nao-imprimir">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={r.por_dia.map((d) => ({ dia: dataBR(d.data, true), total: Number(d.total) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--linha)" />
                  <XAxis dataKey="dia" tick={{ fontSize: 12, fill: 'var(--texto-2)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--texto-2)' }} width={50} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
                  <Tooltip formatter={(v) => brl(Number(v))} contentStyle={{ background: 'var(--superficie)', border: '1px solid var(--linha)', borderRadius: 8 }} />
                  <Bar dataKey="total" name="Comprado" fill="#3f6e8c" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Cartao>

            <Cartao titulo="Itens comprados" className="span-2 sem-padding quebra-antes">
              <div className="rolagem">
                <table className="tabela">
                  <thead><tr><th>Item</th><th>Categoria</th><th className="n">Quantidade</th><th className="n">Total</th><th className="n">Preço médio</th><th className="n">Menor</th><th className="n">Maior</th><th className="n">Variação</th></tr></thead>
                  <tbody>
                    {r.por_insumo.map((i) => {
                      const varia = Number(i.preco_min) ? (Number(i.preco_max) - Number(i.preco_min)) / Number(i.preco_min) : 0
                      return (
                        <tr key={i.insumo + i.insumo_id}>
                          <td className="forte">{i.insumo}{!i.insumo_id && <small className="sub">não é insumo</small>}</td>
                          <td>{i.categoria}</td>
                          <td className="n">{qtd(i.quantidade)} {i.unidade}</td>
                          <td className="n">{brl(i.total)}</td>
                          <td className="n">{brlUnit(i.preco_medio)}</td>
                          <td className="n tenue">{brlUnit(i.preco_min)}</td>
                          <td className="n tenue">{brlUnit(i.preco_max)}</td>
                          <td className="n">{varia >= 0.005 ? <Selo tom={varia > 0.1 ? 'erro' : 'alerta'}>{pct(varia)}</Selo> : <span className="tenue">—</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Cartao>

            <Cartao titulo="Por forma de pagamento">
              <table className="tabela">
                <tbody>
                  {r.por_forma.map((f) => <tr key={f.forma}><td>{f.forma}</td><td className="n">{f.compras}x</td><td className="n">{brl(f.total)}</td></tr>)}
                </tbody>
              </table>
            </Cartao>

            <Cartao titulo="Resumo">
              <table className="tabela">
                <tbody>
                  <tr><td>Valor dos itens</td><td className="n">{brl(Number(k.total) - Number(k.frete) + Number(k.desconto))}</td></tr>
                  <tr><td>+ Fretes</td><td className="n">{brl(k.frete)}</td></tr>
                  <tr><td>− Descontos obtidos</td><td className="n">{brl(k.desconto)}</td></tr>
                  <tr><td className="forte">= Total comprado</td><td className="n forte">{brl(k.total)}</td></tr>
                  <tr><td>Ticket médio por compra</td><td className="n">{brl(k.ticket_medio)}</td></tr>
                </tbody>
              </table>
            </Cartao>

            <Cartao titulo={`Todas as compras de ${mesExtenso(mes)}`} className="span-2 sem-padding">
              <div className="rolagem">
                <table className="tabela">
                  <thead><tr><th>Data</th><th>#</th><th>Fornecedor</th><th>Nota</th><th>Forma</th><th>Situação</th><th className="n">Total</th></tr></thead>
                  <tbody>
                    {compras.map((c) => (
                      <tr key={c.id}>
                        <td>{dataBR(c.data)}</td><td>{c.id}</td><td>{nomeFornecedor(c, fornecedores)}</td><td>{c.numero_nota || '—'}</td>
                        <td>{c.forma_pagamento || '—'}</td><td>{c.status === 'paga' ? `Paga ${dataBR(c.data_pagamento, true)}` : `A pagar ${dataBR(c.vencimento, true)}`}</td>
                        <td className="n">{brl(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td colSpan={6}>Total</td><td className="n">{brl(k.total)}</td></tr></tfoot>
                </table>
              </div>
            </Cartao>
          </div>
        </>
      )}
    </div>
  )
}
