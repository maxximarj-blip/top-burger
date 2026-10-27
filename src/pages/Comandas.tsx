import { useCallback, useEffect, useMemo, useState } from 'react'
import { SeletorDia } from '../components/Periodo'
import { Alerta, Botao, Cabecalho, Cartao, Carregando, Entrada, Selecao, Selo, useAvisos, Vazio } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useCadastros } from '../lib/cadastros'
import { baixarCsv, brl, dataBR, diaSemana, hoje, NOME_MODALIDADE, NOME_STATUS, num } from '../lib/format'
import { buscarTudo, mensagemErro, supabase } from '../lib/supabase'
import type { Comanda, StatusComanda } from '../lib/types'
import { ComandaForm } from './ComandaForm'

type Filtro = 'todas' | 'pendentes' | 'divergentes' | 'nao_conferidas'

export function Comandas() {
  const { pode } = useAuth()
  const cad = useCadastros()
  const { avisar } = useAvisos()
  const gestor = pode('admin', 'gerente')

  const [modo, setModo] = useState<'dia' | 'periodo'>('dia')
  const [dia, setDia] = useState(hoje())
  const [inicio, setInicio] = useState(hoje())
  const [fim, setFim] = useState(hoje())
  const [lista, setLista] = useState<Comanda[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [fechado, setFechado] = useState(false)
  const [clientes, setClientes] = useState<Map<number, string>>(new Map())

  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState(0)
  const [forma, setForma] = useState(0)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set())

  const [editando, setEditando] = useState<Comanda | null>(null)
  const [formAberto, setFormAberto] = useState(false)

  const de = modo === 'dia' ? dia : inicio
  const ate = modo === 'dia' ? dia : fim

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const dados = await buscarTudo<Comanda>((a, b) =>
        supabase.from('comandas').select('*').gte('data', de).lte('data', ate)
          .order('data', { ascending: false }).order('numero', { ascending: false }).range(a, b),
      )
      setLista(dados)
      setErro(null)
      const ids = [...new Set(dados.map((c) => c.cliente_id).filter((x): x is number => x != null))]
      const mapa = new Map<number, string>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await supabase.from('clientes').select('id, nome').in('id', ids.slice(i, i + 200))
        ;(data ?? []).forEach((c) => mapa.set(c.id as number, c.nome as string))
      }
      setClientes(mapa)
      if (modo === 'dia') {
        const { data } = await supabase.from('fechamentos').select('fechado').eq('data', dia).maybeSingle()
        setFechado(Boolean(data?.fechado))
      } else setFechado(false)
    } catch (e) {
      setErro(mensagemErro(e))
    }
    setCarregando(false)
    setSelecionadas(new Set())
  }, [de, ate, modo, dia])

  useEffect(() => {
    carregar()
  }, [carregar])

  // Atalho: "N" abre nova comanda
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement
      if (formAberto || ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) return
      if (e.key.toLowerCase() === 'n' && !fechado) {
        e.preventDefault()
        setEditando(null)
        setFormAberto(true)
      }
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [formAberto, fechado])

  const marketplace = useMemo(() => new Set(cad.canais.filter((c) => c.marketplace).map((c) => c.id)), [cad.canais])
  const divergente = useCallback((c: Comanda) => !marketplace.has(c.canal_id) && c.status !== 'cancelado' && Math.abs(Number(c.diferenca)) >= 0.01, [marketplace])

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return lista.filter((c) => {
      if (canal && c.canal_id !== canal) return false
      if (forma && c.forma_pagamento_id !== forma) return false
      if (filtro === 'pendentes' && c.status !== 'pendente') return false
      if (filtro === 'divergentes' && !divergente(c)) return false
      if (filtro === 'nao_conferidas' && c.conferido) return false
      if (t) {
        const alvo = [c.numero, c.codigo_externo, c.observacao, cad.nomeEntregador(c.entregador_id), brl(c.valor_pago), c.cliente_id ? clientes.get(c.cliente_id) : ''].join(' ').toLowerCase()
        if (!alvo.includes(t)) return false
      }
      return true
    })
  }, [lista, busca, canal, forma, filtro, divergente, cad, clientes])

  const totais = useMemo(() => {
    const validas = filtradas.filter((c) => c.status !== 'cancelado')
    const s = (k: keyof Comanda) => validas.reduce((a, c) => a + Number(c[k]), 0)
    return { qtd: validas.length, comanda: s('valor_comanda'), entrega: s('taxa_entrega'), desconto: s('desconto'), pago: s('valor_pago'), taxa: s('valor_taxa'), liquido: s('valor_liquido') }
  }, [filtradas])

  const contagens = useMemo(() => ({
    pendentes: lista.filter((c) => c.status === 'pendente').length,
    divergentes: lista.filter(divergente).length,
    nao_conferidas: lista.filter((c) => !c.conferido).length,
  }), [lista, divergente])

  const alternar = (id: number) =>
    setSelecionadas((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const conferirSelecionadas = async (valor: boolean) => {
    const ids = [...selecionadas]
    if (!ids.length) return
    const { error } = await supabase.from('comandas').update({ conferido: valor }).in('id', ids)
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar(`${ids.length} comanda(s) ${valor ? 'conferida(s)' : 'desmarcada(s)'}.`)
    carregar()
  }

  const exportar = () => {
    baixarCsv(`comandas_${de}_${ate}.csv`, [
      ['Data', 'Nº', 'Pedido plataforma', 'Cliente', 'Canal', 'Modalidade', 'Entregador', 'Valor comanda', 'Taxa entrega', 'Desconto',
        'Valor pago', 'Forma', 'Máquina', 'Taxa %', 'Valor taxa', 'Líquido', 'Diferença', 'Prev. recebimento', 'Status', 'Conferido', 'Observação'],
      ...filtradas.map((c) => [
        dataBR(c.data), c.numero, c.codigo_externo, c.cliente_id ? clientes.get(c.cliente_id) : '', cad.nomeCanal(c.canal_id), NOME_MODALIDADE[c.modalidade],
        c.entregador_id ? cad.nomeEntregador(c.entregador_id) : '', Number(c.valor_comanda), Number(c.taxa_entrega),
        Number(c.desconto), Number(c.valor_pago), c.forma_pagamento_id ? cad.nomeForma(c.forma_pagamento_id) : '',
        c.maquina_id ? cad.nomeMaquina(c.maquina_id) : '', Number(c.taxa_pct), Number(c.valor_taxa), Number(c.valor_liquido),
        Number(c.diferenca), dataBR(c.data_prevista_recebimento), NOME_STATUS[c.status], c.conferido ? 'Sim' : 'Não', c.observacao,
      ]),
    ])
  }

  const tomStatus: Record<StatusComanda, 'ok' | 'alerta' | 'erro'> = { recebido: 'ok', pendente: 'alerta', cancelado: 'erro' }

  return (
    <div className="pagina">
      <Cabecalho
        titulo="Comandas"
        subtitulo={modo === 'dia' ? `${diaSemana(dia)}, ${dataBR(dia)}` : `${dataBR(inicio)} a ${dataBR(fim)}`}
        acoes={
          <>
            <Botao onClick={exportar} disabled={!filtradas.length}>Exportar CSV</Botao>
            <Botao variante="primario" onClick={() => { setEditando(null); setFormAberto(true) }} disabled={fechado && !pode('admin')} title="Atalho: N">
              + Nova comanda
            </Botao>
          </>
        }
      />

      <div className="barra-filtros">
        <div className="opcoes opcoes-pequenas">
          <button className={modo === 'dia' ? 'ativo' : ''} onClick={() => setModo('dia')}>Dia</button>
          <button className={modo === 'periodo' ? 'ativo' : ''} onClick={() => setModo('periodo')}>Período</button>
        </div>
        {modo === 'dia' ? (
          <SeletorDia valor={dia} aoMudar={setDia} />
        ) : (
          <div className="periodo-datas">
            <input type="date" className="entrada" value={inicio} max={fim} onChange={(e) => e.target.value && setInicio(e.target.value)} />
            <span>até</span>
            <input type="date" className="entrada" value={fim} min={inicio} onChange={(e) => e.target.value && setFim(e.target.value)} />
          </div>
        )}
        <Entrada className="entrada busca" placeholder="Buscar nº, cliente, pedido, entregador, valor…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Selecao value={canal} onChange={(e) => setCanal(Number(e.target.value))}>
          <option value={0}>Todos os canais</option>
          {cad.canais.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </Selecao>
        <Selecao value={forma} onChange={(e) => setForma(Number(e.target.value))}>
          <option value={0}>Todas as formas</option>
          {cad.formas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </Selecao>
      </div>

      <div className="abas">
        {([
          ['todas', `Todas (${lista.length})`],
          ['pendentes', `Pendentes (${contagens.pendentes})`],
          ['divergentes', `Divergências (${contagens.divergentes})`],
          ['nao_conferidas', `Não conferidas (${contagens.nao_conferidas})`],
        ] as [Filtro, string][]).map(([v, r]) => (
          <button key={v} className={filtro === v ? 'ativo' : ''} onClick={() => setFiltro(v)}>{r}</button>
        ))}
      </div>

      {fechado && <Alerta tom="info">Este dia está <strong>fechado</strong>. As comandas estão travadas para edição{pode('admin') ? ' (você é admin e ainda pode editar)' : ''}.</Alerta>}
      {erro && <Alerta tom="erro">{erro}</Alerta>}

      <div className="kpis kpis-compactos">
        <div><span>Comandas</span><strong>{num(totais.qtd)}</strong></div>
        <div><span>Bruto</span><strong>{brl(totais.comanda)}</strong></div>
        <div><span>Entregas</span><strong>{brl(totais.entrega)}</strong></div>
        <div><span>Descontos</span><strong>{brl(totais.desconto)}</strong></div>
        <div><span>Recebido</span><strong>{brl(totais.pago)}</strong></div>
        <div><span>Taxas</span><strong className="neg">{brl(totais.taxa)}</strong></div>
        <div><span>Líquido</span><strong>{brl(totais.liquido)}</strong></div>
      </div>

      {gestor && selecionadas.size > 0 && (
        <div className="barra-selecao">
          <span>{selecionadas.size} selecionada(s)</span>
          <Botao variante="primario" onClick={() => conferirSelecionadas(true)}>Marcar como conferidas</Botao>
          <Botao onClick={() => conferirSelecionadas(false)}>Desmarcar</Botao>
          <Botao variante="fantasma" onClick={() => setSelecionadas(new Set())}>Limpar</Botao>
        </div>
      )}

      <Cartao className="sem-padding">
        {carregando ? (
          <Carregando />
        ) : filtradas.length === 0 ? (
          <Vazio>Nenhuma comanda {lista.length ? 'com esses filtros' : 'nesse dia'}. Aperte <kbd>N</kbd> para lançar.</Vazio>
        ) : (
          <div className="rolagem">
            <table className="tabela tabela-comandas">
              <thead>
                <tr>
                  {gestor && (
                    <th className="col-check">
                      <input type="checkbox" aria-label="Selecionar todas"
                        checked={selecionadas.size > 0 && selecionadas.size === filtradas.length}
                        onChange={(e) => setSelecionadas(e.target.checked ? new Set(filtradas.map((c) => c.id)) : new Set())} />
                    </th>
                  )}
                  {modo === 'periodo' && <th>Data</th>}
                  <th>Nº</th><th>Canal</th><th>Modalidade</th><th>Pagamento</th>
                  <th className="n">Comanda</th><th className="n">Entrega</th><th className="n">Desc.</th>
                  <th className="n">Pago</th><th className="n">Taxa</th><th className="n">Líquido</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => (
                  <tr key={c.id} className={c.status === 'cancelado' ? 'cancelada' : ''} onClick={() => { setEditando(c); setFormAberto(true) }}>
                    {gestor && (
                      <td className="col-check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selecionadas.has(c.id)} onChange={() => alternar(c.id)} aria-label={`Selecionar ${c.numero}`} />
                      </td>
                    )}
                    {modo === 'periodo' && <td>{dataBR(c.data, true)}</td>}
                    <td className="forte">
                      {c.numero}
                      {c.codigo_externo && <small className="sub">{c.codigo_externo}</small>}
                      {c.cliente_id && <small className="sub cliente-tag">👤 {clientes.get(c.cliente_id) ?? '…'}</small>}
                    </td>
                    <td>{cad.nomeCanal(c.canal_id)}</td>
                    <td>
                      {NOME_MODALIDADE[c.modalidade]}
                      {c.entregador_id && <small className="sub">{cad.nomeEntregador(c.entregador_id)}</small>}
                    </td>
                    <td>
                      {c.forma_pagamento_id ? cad.nomeForma(c.forma_pagamento_id) : <span className="neg">—</span>}
                      {c.maquina_id && <small className="sub">{cad.nomeMaquina(c.maquina_id)}</small>}
                    </td>
                    <td className="n">{brl(c.valor_comanda)}</td>
                    <td className="n">{Number(c.taxa_entrega) ? brl(c.taxa_entrega) : ''}</td>
                    <td className="n">{Number(c.desconto) ? brl(c.desconto) : ''}</td>
                    <td className="n forte">
                      {brl(c.valor_pago)}
                      {divergente(c) && <small className="sub neg" title="Pago ≠ comanda + entrega − desconto">dif. {brl(c.diferenca)}</small>}
                    </td>
                    <td className="n neg">{Number(c.valor_taxa) ? brl(c.valor_taxa) : ''}</td>
                    <td className="n">{brl(c.valor_liquido)}</td>
                    <td>
                      <Selo tom={tomStatus[c.status]}>{NOME_STATUS[c.status]}</Selo>
                      {c.conferido && <span className="conferido" title="Conferido">✓</span>}
                      {c.observacao && <span className="obs" title={c.observacao}>💬</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Cartao>

      <ComandaForm aberto={formAberto} aoFechar={() => setFormAberto(false)} aoSalvar={carregar} comanda={editando} dataPadrao={modo === 'dia' ? dia : hoje()} />
    </div>
  )
}
