import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alerta, Botao, Cabecalho, Campo, Cartao, Carregando, Entrada, EntradaValor, Kpi, Selecao, useAvisos } from '../components/ui'
import { brl, dataBR, dataHoraBR, hoje, inicioMes, lerValor, mesExtenso, num } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import { SeletorMes } from './Compras'

/* ------------------------------------------------------------------ tipos */
type GrupoManual = 'impostos' | 'pessoal' | 'ocupacao' | 'administrativas' | 'financeiras' | 'outras'

interface DadosDre {
  mes: string
  calculado_em: string
  vendas: {
    produtos: number; entregas: number; descontos: number; comissoes: number; diferencas: number
    recebido: number; taxas: number; liquido: number; comandas: number
  }
  compras: { grupo: 'cmv' | 'embalagens' | 'operacionais'; categoria: string; valor: number }[]
  ajuste_compras: number
  caixa: { entregadores: number; despesas_caixa: number }
  manuais: Partial<Record<GrupoManual, { valor: number; itens: { id: number; descricao: string; valor: number }[] }>>
  pendencias: {
    mes_em_andamento: boolean; dias_abertos: string[]; nao_conferidas: number; pendentes: number
    dias_com_venda: number; sem_movimento: boolean
  }
  gerado: { gerado_em: string; gerado_por: string | null } | null
}

const GRUPOS: Record<GrupoManual, string> = {
  impostos: 'Impostos sobre vendas (Simples, ISS, ICMS…)',
  pessoal: 'Pessoal (salários, encargos, pró-labore, freelas)',
  ocupacao: 'Ocupação (aluguel, condomínio, energia, água, gás encanado)',
  administrativas: 'Administrativas (contador, sistemas, internet, marketing)',
  financeiras: 'Financeiras (juros, tarifas bancárias, antecipação)',
  outras: 'Outras despesas',
}

/* ------------------------------------------------------------------ montagem do DRE */
type Linha =
  | { tipo: 'grupo'; rotulo: string }
  | { tipo: 'conta'; rotulo: string; valor: number; nivel?: 1 | 2; dica?: string }
  | { tipo: 'total'; rotulo: string; valor: number; forte?: boolean }

function montar(d: DadosDre) {
  const v = d.vendas
  const n = (x: unknown) => Number(x ?? 0)
  const manual = (g: GrupoManual) => n(d.manuais[g]?.valor)
  const porGrupo = (g: string) => d.compras.filter((c) => c.grupo === g)
  const soma = (xs: { valor: number }[]) => xs.reduce((s, x) => s + n(x.valor), 0)

  const bruta = n(v.produtos) + n(v.entregas)
  const deducoes = n(v.descontos) + n(v.comissoes) + n(v.diferencas)
  const recebido = bruta - deducoes
  const impostos = manual('impostos')
  const liquida = recebido - n(v.taxas) - impostos
  const cmv = soma(porGrupo('cmv')) + n(d.ajuste_compras)
  const embalagens = soma(porGrupo('embalagens'))
  const lucroBruto = liquida - cmv - embalagens
  const operacionaisCompras = porGrupo('operacionais')
  const despesasOp = soma(operacionaisCompras) + n(d.caixa.despesas_caixa) + manual('pessoal') + manual('ocupacao') + manual('administrativas') + manual('outras')
  const variaveis = n(d.caixa.entregadores)
  const operacional = lucroBruto - variaveis - despesasOp
  const financeiras = manual('financeiras')
  const resultado = operacional - financeiras

  const linhas: Linha[] = [
    { tipo: 'grupo', rotulo: 'Receita bruta' },
    { tipo: 'conta', rotulo: 'Vendas de produtos', valor: n(v.produtos) },
    { tipo: 'conta', rotulo: 'Taxas de entrega cobradas', valor: n(v.entregas) },
    { tipo: 'total', rotulo: '= Receita bruta', valor: bruta },
    { tipo: 'grupo', rotulo: '(−) Deduções da receita' },
    { tipo: 'conta', rotulo: 'Descontos concedidos', valor: -n(v.descontos) },
    { tipo: 'conta', rotulo: 'Comissões das plataformas (iFood, 99…)', valor: -n(v.comissoes) },
    { tipo: 'conta', rotulo: 'Diferenças de recebimento (caixa próprio)', valor: -n(v.diferencas), dica: 'Negativo = recebeu a menos; positivo = sobra' },
    { tipo: 'conta', rotulo: 'Taxas das maquininhas', valor: -n(v.taxas) },
    { tipo: 'conta', rotulo: 'Impostos sobre vendas', valor: -impostos },
    { tipo: 'total', rotulo: '= Receita líquida', valor: liquida },
    { tipo: 'grupo', rotulo: '(−) Custo das mercadorias vendidas (CMV)' },
    ...porGrupo('cmv').map((c): Linha => ({ tipo: 'conta', rotulo: c.categoria, valor: -n(c.valor), nivel: 2 })),
    ...(n(d.ajuste_compras) ? [{ tipo: 'conta', rotulo: 'Fretes − descontos das notas de compra', valor: -n(d.ajuste_compras), nivel: 2 } as Linha] : []),
    { tipo: 'conta', rotulo: 'Embalagens e descartáveis', valor: -embalagens },
    { tipo: 'total', rotulo: '= Lucro bruto', valor: lucroBruto },
    { tipo: 'grupo', rotulo: '(−) Despesas variáveis' },
    { tipo: 'conta', rotulo: 'Repasse a entregadores', valor: -variaveis },
    { tipo: 'grupo', rotulo: '(−) Despesas operacionais' },
    ...operacionaisCompras.map((c): Linha => ({ tipo: 'conta', rotulo: `Compras · ${c.categoria}`, valor: -n(c.valor), nivel: 2 })),
    { tipo: 'conta', rotulo: 'Despesas pagas no caixa', valor: -n(d.caixa.despesas_caixa) },
    { tipo: 'conta', rotulo: 'Pessoal', valor: -manual('pessoal') },
    { tipo: 'conta', rotulo: 'Ocupação', valor: -manual('ocupacao') },
    { tipo: 'conta', rotulo: 'Administrativas', valor: -manual('administrativas') },
    { tipo: 'conta', rotulo: 'Outras despesas', valor: -manual('outras') },
    { tipo: 'total', rotulo: '= Resultado operacional', valor: operacional },
    { tipo: 'conta', rotulo: '(−) Despesas financeiras', valor: -financeiras },
    { tipo: 'total', rotulo: '= Resultado líquido do mês', valor: resultado, forte: true },
  ]
  return { linhas, bruta, liquida, lucroBruto, cmv: cmv + embalagens, resultado, recebido }
}

/** Motivo (em ordem) que impede gerar o DRE definitivo */
function bloqueio(p: DadosDre['pendencias']): string | null {
  if (p.sem_movimento) return 'SEM VENDAS NESTE MÊS'
  if (p.mes_em_andamento) return 'MÊS EM ANDAMENTO — GERE APÓS O ÚLTIMO DIA'
  if (p.dias_abertos.length) return 'FALTA FECHAMENTO PARA GERAR DRE'
  if (p.nao_conferidas || p.pendentes) return 'FALTA CONCILIAÇÃO PARA GERAR DRE'
  return null
}

const pctDe = (v: number, base: number) => {
  if (!base) return '—'
  const p = Math.round((v / base) * 1000) / 10
  return p === 0 ? (v ? '< 0,1%' : '0%') : `${p.toLocaleString('pt-BR')}%`
}

/* ------------------------------------------------------------------ tela */
export function Dre() {
  const { avisar, confirmar } = useAvisos()
  const [mes, setMes] = useState(inicioMes(hoje(), -1))
  const [vivo, setVivo] = useState<DadosDre | null>(null)
  const [gravado, setGravado] = useState<DadosDre | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r, g] = await Promise.all([
      supabase.rpc('dre_mes', { p_mes: mes }),
      supabase.from('dre_mensal').select('dados').eq('mes', mes).maybeSingle(),
    ])
    if (r.error) setErro(mensagemErro(r.error))
    else { setErro(null); setVivo(r.data as DadosDre) }
    setGravado((g.data?.dados as DadosDre) ?? null)
    setCarregando(false)
  }, [mes])
  useEffect(() => { carregar() }, [carregar])

  const d = gravado ?? vivo
  const dre = useMemo(() => (d ? montar(d) : null), [d])
  const pend = vivo?.pendencias
  const motivo = pend ? bloqueio(pend) : null
  const definitivo = Boolean(gravado && vivo?.gerado)

  const gerar = async () => {
    const ok = await confirmar({
      titulo: `Gerar o DRE de ${mesExtenso(mes)}?`,
      texto: 'O DRE fica gravado como está agora (definitivo). Os lançamentos manuais do mês ficam travados até você desfazer a geração.',
      confirmar: 'Gerar DRE',
    })
    if (!ok) return
    setGerando(true)
    const { error } = await supabase.rpc('gerar_dre', { p_mes: mes })
    setGerando(false)
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar(`DRE de ${mesExtenso(mes)} gerado.`)
    carregar()
  }

  const desfazer = async () => {
    const ok = await confirmar({ titulo: 'Desfazer o DRE gerado?', texto: 'Ele volta a ser provisório e recalculado. Fica registrado na auditoria.', confirmar: 'Desfazer', perigo: true })
    if (!ok) return
    const { error } = await supabase.rpc('desfazer_dre', { p_mes: mes })
    if (error) return avisar(mensagemErro(error), 'erro')
    avisar('DRE voltou a ser provisório.', 'info')
    carregar()
  }

  return (
    <div className="pagina relatorio">
      <Cabecalho
        titulo="DRE"
        subtitulo={`Demonstrativo de resultado · ${mesExtenso(mes)}`}
        acoes={
          <>
            <SeletorMes valor={mes} aoMudar={setMes} />
            <Botao onClick={() => window.print()} disabled={!d}>Imprimir / PDF</Botao>
          </>
        }
      />

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {carregando && !d && <Carregando />}

      {d && dre && pend && (
        <>
          <div className="so-impressao cabecalho-impressao">
            <h2>DRE — {mesExtenso(mes)}</h2>
            <span>{definitivo ? `Gerado em ${dataHoraBR(vivo?.gerado?.gerado_em)}` : 'PROVISÓRIO — mês ainda não fechado/conciliado'}</span>
          </div>

          <StatusDre pend={pend} motivo={motivo} definitivo={definitivo} gerado={vivo?.gerado ?? null}
            gerando={gerando} aoGerar={gerar} aoDesfazer={desfazer} />

          <div className="kpis">
            <Kpi destaque rotulo="Resultado do mês" valor={<span className={dre.resultado < 0 ? 'neg' : ''}>{brl(dre.resultado)}</span>}
              detalhe={`margem ${pctDe(dre.resultado, dre.bruta)} da receita bruta`} />
            <Kpi rotulo="Receita bruta" valor={brl(dre.bruta)} detalhe={`${num(d.vendas.comandas)} comandas`} />
            <Kpi rotulo="Receita líquida" valor={brl(dre.liquida)} detalhe={`${pctDe(dre.liquida, dre.bruta)} da bruta`} />
            <Kpi rotulo="CMV + embalagens" valor={brl(dre.cmv)} detalhe={`${pctDe(dre.cmv, dre.liquida)} da receita líquida`} />
          </div>

          <div className="grade-dre">
            <Cartao titulo={definitivo ? 'Demonstrativo (definitivo)' : 'Demonstrativo (provisório)'} className={`sem-padding ${definitivo ? '' : 'dre-provisorio'}`}>
              <table className="tabela tabela-dre">
                <thead><tr><th>Conta</th><th className="n">Valor</th><th className="n">% receita</th></tr></thead>
                <tbody>
                  {dre.linhas.map((l, i) => l.tipo === 'grupo' ? (
                    <tr key={i} className="dre-grupo"><td colSpan={3}>{l.rotulo}</td></tr>
                  ) : (
                    <tr key={i} className={l.tipo === 'total' ? `dre-total ${l.forte ? 'dre-final' : ''}` : l.nivel === 2 ? 'dre-sub' : ''}>
                      <td>{l.rotulo}{l.tipo === 'conta' && l.dica && <small className="sub">{l.dica}</small>}</td>
                      <td className={`n ${l.valor < 0 ? 'neg' : ''}`}>{l.valor === 0 && l.tipo === 'conta' ? '—' : brl(l.valor)}</td>
                      <td className="n tenue">{l.valor ? pctDe(l.valor, dre.bruta) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="campo-dica dre-notas">
                Regime de competência pela data da venda e da compra. CMV estimado pelas compras do mês (sem inventário de estoque).
                Sangrias e suprimentos não entram (são movimentação de dinheiro, não resultado).
                {!definitivo && ` Calculado em ${dataHoraBR(d.calculado_em)}.`}
              </p>
            </Cartao>

            <LancamentosManuais mes={mes} dados={d} travado={definitivo} aoMudar={carregar} />
          </div>
        </>
      )}
    </div>
  )
}

function StatusDre({ pend, motivo, definitivo, gerado, gerando, aoGerar, aoDesfazer }: {
  pend: DadosDre['pendencias']; motivo: string | null; definitivo: boolean; gerado: DadosDre['gerado']
  gerando: boolean; aoGerar: () => void; aoDesfazer: () => void
}) {
  if (definitivo) {
    return (
      <div className="dre-status dre-ok nao-imprimir">
        <div>
          <strong>DRE gerado</strong>
          <span>em {dataHoraBR(gerado?.gerado_em)}{gerado?.gerado_por ? ` por ${gerado.gerado_por}` : ''} · valores congelados</span>
        </div>
        <Botao variante="fantasma" onClick={aoDesfazer}>Desfazer geração</Botao>
      </div>
    )
  }
  const dias = pend.dias_abertos
  return (
    <div className="dre-status nao-imprimir">
      <div>
        <strong>DRE provisório — {motivo ? 'ainda incompleto' : 'pronto para gerar'}</strong>
        <ul>
          {pend.mes_em_andamento && <li>O mês ainda não terminou.</li>}
          {dias.length > 0 && (
            <li>
              <b>Falta fechamento:</b> {dias.length} dia(s) com vendas sem caixa fechado —{' '}
              {dias.slice(0, 8).map((x) => dataBR(x, true)).join(', ')}{dias.length > 8 ? '…' : ''}{' '}
              <Link to="/caixa">Fechamento de caixa →</Link>
            </li>
          )}
          {(pend.nao_conferidas > 0 || pend.pendentes > 0) && (
            <li>
              <b>Falta conciliação:</b> {num(pend.nao_conferidas)} comanda(s) não conferida(s)
              {pend.pendentes > 0 && <>, {num(pend.pendentes)} pendente(s)</>} <Link to="/comandas">Comandas →</Link>
            </li>
          )}
          {!motivo && <li>Todos os dias fechados e todas as comandas conferidas.</li>}
        </ul>
      </div>
      <Botao variante="primario" className={motivo ? 'btn-bloqueado' : ''} disabled={!!motivo} carregando={gerando} onClick={aoGerar} title={motivo ?? 'Gravar o DRE definitivo do mês'}>
        {motivo ?? 'Gerar DRE do mês'}
      </Botao>
    </div>
  )
}

function LancamentosManuais({ mes, dados, travado, aoMudar }: { mes: string; dados: DadosDre; travado: boolean; aoMudar: () => void }) {
  const { avisar, confirmar } = useAvisos()
  const [grupo, setGrupo] = useState<GrupoManual>('pessoal')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [salvando, setSalvando] = useState(false)
  const grupos = Object.keys(GRUPOS) as GrupoManual[]
  const total = grupos.reduce((s, g) => s + Number(dados.manuais[g]?.valor ?? 0), 0)

  const adicionar = async () => {
    if (!descricao.trim()) return avisar('Descreva a despesa (ex.: Folha de outubro).', 'erro')
    if (!lerValor(valor)) return avisar('Informe o valor.', 'erro')
    setSalvando(true)
    const { error } = await supabase.from('dre_lancamentos').insert({ mes, grupo, descricao: descricao.trim(), valor: lerValor(valor) })
    setSalvando(false)
    if (error) return avisar(mensagemErro(error), 'erro')
    setDescricao(''); setValor('')
    aoMudar()
  }
  const remover = async (id: number, desc: string) => {
    if (!(await confirmar({ titulo: `Remover "${desc}"?`, texto: 'A remoção fica registrada na auditoria.', confirmar: 'Remover', perigo: true }))) return
    const { error } = await supabase.from('dre_lancamentos').delete().eq('id', id)
    if (error) return avisar(mensagemErro(error), 'erro')
    aoMudar()
  }

  return (
    <Cartao titulo="Despesas fora do sistema" className="dre-manuais">
      <p className="campo-dica">
        Folha, aluguel, impostos e outras contas que não passam por Compras nem pelo caixa. Lance o total do mês para o DRE ficar completo.
      </p>
      {grupos.filter((g) => dados.manuais[g]?.itens.length).map((g) => (
        <Fragment key={g}>
          <h3 className="sub-titulo">{GRUPOS[g].split(' (')[0]}</h3>
          <table className="tabela">
            <tbody>
              {dados.manuais[g]!.itens.map((it) => (
                <tr key={it.id}>
                  <td>{it.descricao}</td>
                  <td className="n">{brl(it.valor)}</td>
                  <td className="n nao-imprimir">{!travado && <button className="link" onClick={() => remover(it.id, it.descricao)}>remover</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Fragment>
      ))}
      {total === 0 && <p className="tenue">Nenhuma despesa lançada para {mesExtenso(mes)}.</p>}
      {total > 0 && <p className="dre-manuais-total">Total lançado: <strong>{brl(total)}</strong></p>}
      {!travado && (
        <div className="dre-novo nao-imprimir">
          <Campo rotulo="Grupo">
            <Selecao value={grupo} onChange={(e) => setGrupo(e.target.value as GrupoManual)}>
              {grupos.map((g) => <option key={g} value={g}>{GRUPOS[g]}</option>)}
            </Selecao>
          </Campo>
          <Campo rotulo="Descrição"><Entrada value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Folha de pagamento" /></Campo>
          <Campo rotulo="Valor"><EntradaValor valor={valor} aoMudar={setValor} /></Campo>
          <Botao onClick={adicionar} carregando={salvando}>+ Lançar</Botao>
        </div>
      )}
      {travado && <p className="campo-dica">DRE gerado: desfaça a geração para alterar.</p>}
    </Cartao>
  )
}
