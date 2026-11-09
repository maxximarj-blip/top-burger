import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SeletorDia } from '../components/Periodo'
import { Alerta, Botao, Cabecalho, Campo, Cartao, Carregando, Entrada, EntradaValor, Kpi, Modal, Selecao, Selo, useAvisos, Vazio } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useCadastros } from '../lib/cadastros'
import { brl, dataBR, dataHoraBR, diaSemana, hoje, lerValor, NOME_MOVIMENTO, NOME_TURNO, num, valorParaCampo } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import { SeletorEmpresa, TagEmpresa, useEmpresas } from '../lib/empresas'
import type { MovimentoCaixa, ResumoDia, ResumoTurno, TipoMovimento } from '../lib/types'

export function Fechamento() {
  const { pode } = useAuth()
  const cad = useCadastros()
  const { avisar, confirmar } = useAvisos()
  const gestor = pode('admin', 'gerente')
  const emp = useEmpresas()
  const empresaCaixa = emp.ativas.find((e) => e.controla_comandas)?.id ?? emp.padrao

  const [dia, setDia] = useState(hoje())
  const [resumo, setResumo] = useState<ResumoDia | null>(null)
  const [movs, setMovs] = useState<MovimentoCaixa[]>([])
  const [turnos, setTurnos] = useState<ResumoTurno[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  const [fundo, setFundo] = useState('')
  const [contado, setContado] = useState('')
  const [obs, setObs] = useState('')
  const [movAberto, setMovAberto] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r, m, t] = await Promise.all([
      supabase.rpc('resumo_dia', { p_data: dia }),
      supabase.from('movimentos_caixa').select('*').eq('data', dia).order('criado_em'),
      supabase.rpc('resumo_turnos', { p_inicio: dia, p_fim: dia }),
    ])
    setTurnos((t.data as ResumoTurno[]) ?? [])
    if (r.error) setErro(mensagemErro(r.error))
    else {
      setErro(null)
      const res = r.data as ResumoDia
      setResumo(res)
      setFundo(valorParaCampo(res.fundo_troco))
      setContado(res.fechamento?.dinheiro_contado != null ? valorParaCampo(res.fechamento.dinheiro_contado) : '')
      setObs('')
    }
    setMovs((m.data as MovimentoCaixa[]) ?? [])
    setCarregando(false)
  }, [dia])

  useEffect(() => {
    carregar()
  }, [carregar])

  const fechado = Boolean(resumo?.fechamento?.fechado)
  const k = resumo?.resumo.kpis
  const esperadoAtual = resumo ? lerValor(fundo) + resumo.vendas_dinheiro + resumo.suprimentos - resumo.saidas : 0
  const diferenca = contado ? lerValor(contado) - esperadoAtual : null

  const salvarFundo = async () => {
    const { error } = await supabase.rpc('definir_fundo_troco', { p_data: dia, p_valor: lerValor(fundo) })
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar('Fundo de troco salvo.')
    carregar()
  }

  const fechar = async () => {
    if (!contado) return avisar('Informe quanto tem de dinheiro na gaveta.', 'erro')
    const ok = await confirmar({
      titulo: `Fechar o caixa de ${dataBR(dia)}?`,
      texto: (
        <>
          <p>Depois de fechado, ninguém altera comandas desse dia (só um admin, reabrindo).</p>
          <p>Dinheiro esperado <strong>{brl(esperadoAtual)}</strong> · contado <strong>{brl(lerValor(contado))}</strong> ·{' '}
            diferença <strong className={diferenca && Math.abs(diferenca) >= 0.01 ? 'neg' : ''}>{brl(diferenca)}</strong></p>
        </>
      ),
      confirmar: 'Fechar caixa',
    })
    if (!ok) return
    setSalvando(true)
    if (lerValor(fundo) !== resumo?.fundo_troco) await supabase.rpc('definir_fundo_troco', { p_data: dia, p_valor: lerValor(fundo) })
    const { error } = await supabase.rpc('fechar_dia', { p_data: dia, p_dinheiro_contado: lerValor(contado), p_observacao: obs || null })
    setSalvando(false)
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar('Caixa fechado.')
    carregar()
  }

  const reabrir = async () => {
    const motivo = window.prompt('Motivo da reabertura (fica registrado):')
    if (!motivo) return
    const { error } = await supabase.rpc('reabrir_dia', { p_data: dia, p_motivo: motivo })
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar('Dia reaberto.', 'info')
    carregar()
  }

  const excluirMov = async (m: MovimentoCaixa) => {
    const ok = await confirmar({ titulo: 'Excluir movimento?', texto: `${NOME_MOVIMENTO[m.tipo]} de ${brl(m.valor)} — ${m.descricao}`, confirmar: 'Excluir', perigo: true })
    if (!ok) return
    const { error } = await supabase.from('movimentos_caixa').delete().eq('id', m.id)
    if (error) return avisar(mensagemErro(error), 'erro')
    carregar()
  }

  return (
    <div className="pagina">
      <Cabecalho
        titulo="Fechamento de caixa"
        subtitulo={`${diaSemana(dia)}, ${dataBR(dia)}`}
        acoes={<SeletorDia valor={dia} aoMudar={setDia} />}
      />

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {carregando && !resumo && <Carregando />}

      {resumo && k && (
        <>
          {fechado ? (
            <Alerta tom="ok">
              Caixa <strong>fechado</strong> em {dataHoraBR(resumo.fechamento?.fechado_em)}.
              {pode('admin') && <> <button className="link" onClick={reabrir}>Reabrir dia</button></>}
            </Alerta>
          ) : k.pendentes > 0 ? (
            <Alerta tom="alerta">
              Há <strong>{k.pendentes}</strong> comanda(s) pendente(s) — resolva antes de fechar. <Link to="/comandas">Ver comandas →</Link>
            </Alerta>
          ) : null}

          <div className="kpis">
            <Kpi destaque rotulo="Recebido no dia" valor={brl(k.valor_pago)} detalhe={`${num(k.comandas)} comandas`} />
            <Kpi rotulo="Líquido" valor={brl(k.valor_liquido)} detalhe={`taxas ${brl(k.valor_taxa)}`} />
            <Kpi rotulo="Ticket médio" valor={brl(k.ticket_medio)} />
            <Kpi rotulo="Não conferidas" valor={num(k.nao_conferidas)} detalhe={k.divergencias ? `${k.divergencias} com divergência` : 'sem divergências'} />
          </div>

          <div className="grade-painel">
            {turnos.length > 0 && <SubtotaisTurno turnos={turnos} />}

            <Cartao titulo="Recebimentos por forma">
              {resumo.resumo.por_forma.length === 0 ? <Vazio>Nenhuma comanda no dia.</Vazio> : (
                <table className="tabela">
                  <thead><tr><th>Forma</th><th className="n">Comandas</th><th className="n">Recebido</th><th className="n">Líquido</th></tr></thead>
                  <tbody>
                    {resumo.resumo.por_forma.map((f) => (
                      <tr key={f.forma}><td>{f.forma}</td><td className="n">{f.comandas}</td><td className="n">{brl(f.valor_pago)}</td><td className="n">{brl(f.valor_liquido)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>Total</td><td className="n">{k.comandas}</td><td className="n">{brl(k.valor_pago)}</td><td className="n">{brl(k.valor_liquido)}</td></tr></tfoot>
                </table>
              )}
              {resumo.resumo.por_maquina.length > 0 && (
                <>
                  <h3 className="sub-titulo">Conferir com o extrato das maquininhas</h3>
                  <table className="tabela">
                    <tbody>
                      {resumo.resumo.por_maquina.map((m) => (
                        <tr key={m.maquina + m.forma}><td>{m.maquina}</td><td>{m.forma}</td><td className="n">{m.comandas}x</td><td className="n">{brl(m.valor_pago)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Cartao>

            <Cartao titulo="Gaveta (dinheiro)">
              <div className="conta-caixa">
                <div className="linha-conta">
                  <span>Fundo de troco</span>
                  <div className="linha-conta-editar">
                    <EntradaValor valor={fundo} aoMudar={setFundo} disabled={fechado} />
                    {!fechado && lerValor(fundo) !== resumo.fundo_troco && <Botao onClick={salvarFundo}>Salvar</Botao>}
                  </div>
                </div>
                <div className="linha-conta"><span>+ Vendas em dinheiro</span><strong>{brl(resumo.vendas_dinheiro)}</strong></div>
                <div className="linha-conta"><span>+ Suprimentos</span><strong>{brl(resumo.suprimentos)}</strong></div>
                <div className="linha-conta"><span>− Sangrias, despesas e pagamentos</span><strong className="neg">{brl(resumo.saidas)}</strong></div>
                <div className="linha-conta total"><span>= Dinheiro esperado</span><strong>{brl(esperadoAtual)}</strong></div>
                <div className="linha-conta">
                  <span>Dinheiro contado</span>
                  <EntradaValor valor={contado} aoMudar={setContado} disabled={fechado} />
                </div>
                {diferenca != null && (
                  <div className={`linha-conta total ${Math.abs(diferenca) >= 0.01 ? 'neg' : 'pos'}`}>
                    <span>{diferenca > 0 ? 'Sobra' : diferenca < 0 ? 'Falta' : 'Bateu!'}</span>
                    <strong>{brl(Math.abs(diferenca))}</strong>
                  </div>
                )}
                {!fechado && gestor && (
                  <>
                    <Campo rotulo="Observação do fechamento">
                      <Entrada value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
                    </Campo>
                    <Botao variante="primario" className="btn-bloco" onClick={fechar} carregando={salvando} disabled={k.pendentes > 0}>
                      Fechar caixa do dia
                    </Botao>
                  </>
                )}
                {!fechado && !gestor && <p className="campo-dica">O fechamento é feito por um gerente.</p>}
                {fechado && resumo.fechamento?.observacao && <p className="campo-dica pre">{resumo.fechamento.observacao}</p>}
              </div>
            </Cartao>

            <Cartao titulo="Movimentos do caixa" className="span-2" acoes={!fechado && <Botao onClick={() => setMovAberto(true)}>+ Movimento</Botao>}>
              {movs.length === 0 ? <Vazio>Nenhuma sangria, suprimento ou despesa.</Vazio> : (
                <table className="tabela">
                  <thead><tr><th>Hora</th><th>Tipo</th><th>Descrição</th><th className="n">Valor</th><th /></tr></thead>
                  <tbody>
                    {movs.map((m) => (
                      <tr key={m.id}>
                        <td>{dataHoraBR(m.criado_em).split(' ')[1]}</td>
                        <td><Selo tom={m.tipo === 'suprimento' ? 'ok' : 'neutro'}>{NOME_MOVIMENTO[m.tipo]}</Selo></td>
                        <td>{m.descricao}{m.entregador_id && <small className="sub">{cad.nomeEntregador(m.entregador_id)}</small>}{m.empresa_id !== empresaCaixa && <small className="sub"><TagEmpresa id={m.empresa_id} /></small>}</td>
                        <td className={`n ${m.tipo === 'suprimento' ? '' : 'neg'}`}>{m.tipo === 'suprimento' ? '+' : '−'} {brl(m.valor)}</td>
                        <td className="n">{gestor && !fechado && <button className="link" onClick={() => excluirMov(m)}>excluir</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Cartao>
          </div>
        </>
      )}

      <NovoMovimento aberto={movAberto} aoFechar={() => setMovAberto(false)} data={dia} aoSalvar={carregar} />
    </div>
  )
}

/** Subtotais do dia por turno + recebimentos por forma em cada turno */
function SubtotaisTurno({ turnos }: { turnos: ResumoTurno[] }) {
  const total = (k: keyof ResumoTurno) => turnos.reduce((s, t) => s + Number(t[k]), 0)
  const formas = [...new Set(turnos.flatMap((t) => t.por_forma.map((f) => f.forma)))]
    .map((forma) => ({ forma, total: turnos.reduce((s, t) => s + Number(t.por_forma.find((f) => f.forma === forma)?.valor_pago ?? 0), 0) }))
    .sort((a, b) => b.total - a.total)
  const valorForma = (t: ResumoTurno, forma: string) => t.por_forma.find((f) => f.forma === forma)
  return (
    <Cartao titulo="Subtotais por turno" className="span-2">
      <table className="tabela tabela-turnos">
        <thead>
          <tr><th>Turno</th><th className="n">Comandas</th><th className="n">Bruto</th><th className="n">Descontos</th><th className="n">Recebido</th><th className="n">Taxas</th><th className="n">Líquido</th><th className="n">Em dinheiro</th><th className="n">Ticket médio</th></tr>
        </thead>
        <tbody>
          {turnos.map((t) => (
            <tr key={t.turno}>
              <td><span className={`turno-tag turno-${t.turno}`}>{NOME_TURNO[t.turno]}</span>
                {t.pendentes > 0 && <small className="sub neg">{t.pendentes} pendente(s)</small>}</td>
              <td className="n">{num(t.comandas)}</td>
              <td className="n">{brl(Number(t.valor_comanda) + Number(t.taxa_entrega))}</td>
              <td className="n">{Number(t.desconto) ? brl(t.desconto) : '—'}</td>
              <td className="n forte">{brl(t.valor_pago)}</td>
              <td className="n neg">{Number(t.valor_taxa) ? brl(t.valor_taxa) : '—'}</td>
              <td className="n">{brl(t.valor_liquido)}</td>
              <td className="n">{brl(t.dinheiro)}</td>
              <td className="n">{brl(t.ticket_medio)}</td>
            </tr>
          ))}
        </tbody>
        {turnos.length > 1 && (
          <tfoot>
            <tr>
              <td>Dia</td><td className="n">{num(total('comandas'))}</td>
              <td className="n">{brl(total('valor_comanda') + total('taxa_entrega'))}</td><td className="n">{brl(total('desconto'))}</td>
              <td className="n">{brl(total('valor_pago'))}</td><td className="n neg">{brl(total('valor_taxa'))}</td>
              <td className="n">{brl(total('valor_liquido'))}</td><td className="n">{brl(total('dinheiro'))}</td>
              <td className="n">{brl(total('comandas') ? total('valor_pago') / total('comandas') : 0)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      <h3 className="sub-titulo">Recebido por forma em cada turno</h3>
      <table className="tabela tabela-turnos">
        <thead>
          <tr><th>Forma</th>{turnos.map((t) => <th key={t.turno} className="n">{NOME_TURNO[t.turno]}</th>)}{turnos.length > 1 && <th className="n">Dia</th>}</tr>
        </thead>
        <tbody>
          {formas.map(({ forma, total: tf }) => (
            <tr key={forma}>
              <td>{forma}</td>
              {turnos.map((t) => {
                const v = valorForma(t, forma)
                return <td key={t.turno} className="n">{v ? <>{brl(v.valor_pago)}<small className="sub">{v.comandas}x</small></> : '—'}</td>
              })}
              {turnos.length > 1 && <td className="n forte">{brl(tf)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Cartao>
  )
}

export function NovoMovimento({ aberto, aoFechar, data, aoSalvar, inicial }: {
  aberto: boolean; aoFechar: () => void; data: string; aoSalvar: () => void
  inicial?: { tipo: TipoMovimento; entregador_id?: number; valor?: number; descricao?: string }
}) {
  const cad = useCadastros()
  const { avisar } = useAvisos()
  const [tipo, setTipo] = useState<TipoMovimento>('sangria')
  const [valor, setValor] = useState('')
  const [descricao, setDescricao] = useState('')
  const [entregador, setEntregador] = useState(0)
  const [dataMov, setDataMov] = useState(data)
  const emp = useEmpresas()
  const empresaCaixa = emp.ativas.find((e) => e.controla_comandas)?.id ?? emp.padrao
  const [empresa, setEmpresa] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setTipo(inicial?.tipo ?? 'sangria')
    setValor(inicial?.valor ? valorParaCampo(inicial.valor) : '')
    setDescricao(inicial?.descricao ?? '')
    setEntregador(inicial?.entregador_id ?? 0)
    setDataMov(data)
    setEmpresa(0)
    setErro(null)
  }, [aberto, inicial, data])

  const salvar = async () => {
    if (!lerValor(valor)) return setErro('Informe o valor.')
    if (tipo === 'pagamento_entregador' && !entregador) return setErro('Escolha o entregador.')
    const desc = descricao.trim() || (tipo === 'pagamento_entregador' ? `Pagamento ${cad.nomeEntregador(entregador)}` : '')
    if (!desc) return setErro('Descreva o movimento.')
    setSalvando(true)
    const { error } = await supabase.from('movimentos_caixa').insert({
      data: dataMov, tipo, valor: lerValor(valor), descricao: desc,
      empresa_id: tipo === 'despesa' && empresa ? empresa : empresaCaixa,
      entregador_id: tipo === 'pagamento_entregador' ? entregador : null,
    })
    setSalvando(false)
    if (error) return setErro(mensagemErro(error))
    avisar('Movimento registrado.')
    aoSalvar()
    aoFechar()
  }

  return (
    <Modal aberto={aberto} aoFechar={aoFechar} titulo="Movimento de caixa"
      rodape={<><Botao variante="fantasma" onClick={aoFechar}>Cancelar</Botao><Botao variante="primario" onClick={salvar} carregando={salvando}>Registrar</Botao></>}>
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <div className="grade-2">
        <Campo rotulo="Tipo">
          <Selecao value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimento)}>
            {(Object.keys(NOME_MOVIMENTO) as TipoMovimento[]).map((t) => <option key={t} value={t}>{NOME_MOVIMENTO[t]}</option>)}
          </Selecao>
        </Campo>
        <Campo rotulo="Data"><Entrada type="date" value={dataMov} onChange={(e) => setDataMov(e.target.value)} /></Campo>
      </div>
      {tipo === 'pagamento_entregador' && (
        <Campo rotulo="Entregador">
          <Selecao value={entregador} onChange={(e) => setEntregador(Number(e.target.value))}>
            <option value={0}>Escolha…</option>
            {cad.entregadores.filter((e) => e.ativo).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </Selecao>
        </Campo>
      )}
      {tipo === 'despesa' && emp.varias && (
        <Campo rotulo="Despesa de qual empresa (CNPJ)?" dica="O dinheiro sai desta gaveta; a despesa entra no DRE do CNPJ escolhido">
          <SeletorEmpresa valor={empresa || empresaCaixa} aoMudar={setEmpresa} aria-label="Empresa da despesa" />
        </Campo>
      )}
      <Campo rotulo="Valor"><EntradaValor valor={valor} aoMudar={setValor} /></Campo>
      <Campo rotulo="Descrição"><Entrada value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: compra de gelo, sangria para cofre…" /></Campo>
    </Modal>
  )
}
