import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Periodo, type Intervalo } from '../components/Periodo'
import { Alerta, Cabecalho, Cartao, Carregando, Kpi, Vazio } from '../components/ui'
import { brl, dataBR, DIAS_SEMANA, fimMes, hoje, inicioMes, NOME_MODALIDADE, num, pct } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { Relatorio } from '../lib/types'

const CORES = ['#e0912a', '#c8402a', '#5b7f3a', '#3f6e8c', '#8a5a9e', '#9c6b3c', '#4f8f86']

function useRelatorio(p: Intervalo) {
  const [dados, setDados] = useState<Relatorio | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  useEffect(() => {
    let ativo = true
    setCarregando(true)
    supabase.rpc('relatorio_periodo', { p_inicio: p.inicio, p_fim: p.fim }).then(({ data, error }) => {
      if (!ativo) return
      if (error) setErro(mensagemErro(error))
      else {
        setErro(null)
        setDados(data as Relatorio)
      }
      setCarregando(false)
    })
    return () => {
      ativo = false
    }
  }, [p.inicio, p.fim])
  return { dados, erro, carregando }
}

const dicaMoeda = (v: unknown) => brl(Number(v))

export function Painel() {
  const [periodo, setPeriodo] = useState<Intervalo>({ inicio: inicioMes(hoje()), fim: fimMes(hoje()) })
  const { dados, erro, carregando } = useRelatorio(periodo)
  const k = dados?.kpis

  const matriz = useMemo(() => {
    if (!dados) return null
    const formas = [...new Set(dados.canal_forma.map((x) => x.forma))]
    const ordemFormas = dados.por_forma.map((f) => f.forma).filter((f) => formas.includes(f))
    const canais = dados.por_canal.map((c) => c.canal)
    const valor = (c: string, f: string) => dados.canal_forma.find((x) => x.canal === c && x.forma === f)?.valor_pago ?? 0
    return { formas: ordemFormas, canais, valor }
  }, [dados])

  const semana = useMemo(
    () =>
      (dados?.por_dia_semana ?? []).map((d) => ({
        dia: DIAS_SEMANA[d.dow],
        media: d.dias ? Number(d.valor_pago) / d.dias : 0,
        comandas: d.dias ? d.comandas / d.dias : 0,
      })),
    [dados],
  )

  return (
    <div className="pagina">
      <Cabecalho titulo="Painel" subtitulo={`${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)}`} acoes={<Periodo valor={periodo} aoMudar={setPeriodo} />} />

      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {carregando && !dados && <Carregando />}

      {k && (
        <>
          {(k.pendentes > 0 || k.divergencias > 0) && (
            <Alerta tom="alerta">
              {k.pendentes > 0 && <span><strong>{k.pendentes}</strong> comanda(s) pendente(s). </span>}
              {k.divergencias > 0 && (
                <span>
                  <strong>{k.divergencias}</strong> comanda(s) de canal próprio com valor pago diferente de comanda + entrega − desconto.{' '}
                </span>
              )}
              <Link to="/comandas">Revisar comandas →</Link>
            </Alerta>
          )}

          <div className="kpis">
            <Kpi destaque rotulo="Faturamento recebido" valor={brl(k.valor_pago)} detalhe={`${num(k.comandas)} comandas`} />
            <Kpi rotulo="Líquido (após maquininha)" valor={brl(k.valor_liquido)} detalhe={`taxas ${brl(k.valor_taxa)}`} />
            <Kpi rotulo="Ticket médio" valor={brl(k.ticket_medio)} />
            <Kpi rotulo="Valor bruto das comandas" valor={brl(k.valor_comanda)} detalhe={`+ ${brl(k.taxa_entrega)} em entregas`} />
            <Kpi rotulo="Descontos" valor={brl(k.desconto)} detalhe={`${num(k.comandas_desconto)} comandas`} />
            <Kpi rotulo="Comissão / desconto das plataformas" valor={brl(k.comissao_plataformas)} detalhe="99 + iFood: bruto − recebido" />
          </div>

          <div className="grade-painel">
            <Cartao titulo="Vendas por dia" className="span-2">
              {dados.por_dia.length === 0 ? (
                <Vazio>Nenhuma venda no período.</Vazio>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={dados.por_dia.map((d) => ({ ...d, dia: dataBR(d.data, true), valor_pago: Number(d.valor_pago) }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--linha)" />
                    <XAxis dataKey="dia" tick={{ fontSize: 12, fill: 'var(--texto-2)' }} />
                    <YAxis yAxisId="v" tick={{ fontSize: 12, fill: 'var(--texto-2)' }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={36} />
                    <YAxis yAxisId="q" orientation="right" tick={{ fontSize: 12, fill: 'var(--texto-2)' }} width={30} />
                    <Tooltip formatter={(v, n) => (n === 'Comandas' ? v : dicaMoeda(v))} contentStyle={{ background: 'var(--superficie)', border: '1px solid var(--linha)', borderRadius: 8 }} />
                    <Bar yAxisId="v" dataKey="valor_pago" name="Recebido" fill="#e0912a" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="q" dataKey="comandas" name="Comandas" stroke="#c8402a" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </Cartao>

            <Cartao titulo="Por canal">
              <table className="tabela">
                <thead>
                  <tr><th>Canal</th><th className="n">Comandas</th><th className="n">Recebido</th><th className="n">Ticket</th></tr>
                </thead>
                <tbody>
                  {dados.por_canal.map((c, i) => (
                    <tr key={c.canal}>
                      <td><span className="ponto" style={{ background: CORES[i % CORES.length] }} />{c.canal}</td>
                      <td className="n">{num(c.comandas)}</td>
                      <td className="n">{brl(c.valor_pago)}</td>
                      <td className="n">{brl(c.ticket_medio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="barra-empilhada">
                {dados.por_canal.map((c, i) => (
                  <span key={c.canal} style={{ flex: Number(c.valor_pago), background: CORES[i % CORES.length] }} title={`${c.canal}: ${pct(Number(c.valor_pago) / k.valor_pago)}`} />
                ))}
              </div>
            </Cartao>

            <Cartao titulo="Por forma de pagamento">
              <ResponsiveContainer width="100%" height={Math.max(160, dados.por_forma.length * 34)}>
                <BarChart layout="vertical" data={dados.por_forma.map((f) => ({ ...f, valor_pago: Number(f.valor_pago) }))} margin={{ left: 10 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="forma" width={130} tick={{ fontSize: 12, fill: 'var(--texto)' }} />
                  <Tooltip formatter={dicaMoeda} contentStyle={{ background: 'var(--superficie)', border: '1px solid var(--linha)', borderRadius: 8 }} />
                  <Bar dataKey="valor_pago" name="Recebido" radius={[0, 4, 4, 0]}>
                    {dados.por_forma.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Cartao>

            {matriz && matriz.canais.length > 0 && (
              <Cartao titulo="Canal × forma de pagamento" className="span-2">
                <div className="rolagem">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Canal</th>
                        {matriz.formas.map((f) => <th key={f} className="n">{f}</th>)}
                        <th className="n">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matriz.canais.map((c) => (
                        <tr key={c}>
                          <td>{c}</td>
                          {matriz.formas.map((f) => <td key={f} className="n">{matriz.valor(c, f) ? brl(matriz.valor(c, f)) : '—'}</td>)}
                          <td className="n forte">{brl(dados.por_canal.find((x) => x.canal === c)?.valor_pago)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        {matriz.formas.map((f) => <td key={f} className="n">{brl(dados.por_forma.find((x) => x.forma === f)?.valor_pago)}</td>)}
                        <td className="n">{brl(k.valor_pago)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Cartao>
            )}

            <Cartao titulo="Maquininhas">
              {dados.por_maquina.length === 0 ? (
                <Vazio>Nenhuma venda em maquininha.</Vazio>
              ) : (
                <table className="tabela">
                  <thead>
                    <tr><th>Máquina</th><th>Forma</th><th className="n">Bruto</th><th className="n">Taxa</th><th className="n">Líquido</th></tr>
                  </thead>
                  <tbody>
                    {dados.por_maquina.map((m) => (
                      <tr key={m.maquina + m.forma}>
                        <td>{m.maquina}</td><td>{m.forma}</td>
                        <td className="n">{brl(m.valor_pago)}</td>
                        <td className="n neg">{brl(m.valor_taxa)}</td>
                        <td className="n">{brl(m.valor_liquido)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total</td>
                      <td className="n">{brl(dados.por_maquina.reduce((s, m) => s + Number(m.valor_pago), 0))}</td>
                      <td className="n neg">{brl(k.valor_taxa)}</td>
                      <td className="n">{brl(dados.por_maquina.reduce((s, m) => s + Number(m.valor_liquido), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </Cartao>

            <Cartao titulo="Média por dia da semana">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={semana}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--linha)" />
                  <XAxis dataKey="dia" tick={{ fontSize: 12, fill: 'var(--texto-2)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--texto-2)' }} tickFormatter={(v) => `${Math.round(v / 100) / 10}k`} width={36} />
                  <Tooltip formatter={(v, n) => (n === 'Comandas/dia' ? Number(v).toFixed(0) : dicaMoeda(v))} contentStyle={{ background: 'var(--superficie)', border: '1px solid var(--linha)', borderRadius: 8 }} />
                  <Bar dataKey="media" name="Recebido/dia" fill="#5b7f3a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Cartao>

            <Cartao titulo="Modalidade">
              <table className="tabela">
                <tbody>
                  {dados.por_modalidade.map((m) => (
                    <tr key={m.modalidade}>
                      <td>{NOME_MODALIDADE[m.modalidade]}</td>
                      <td className="n">{num(m.comandas)}</td>
                      <td className="n">{pct(m.comandas / k.comandas)}</td>
                      <td className="n">{brl(m.valor_pago)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Cartao>
          </div>
        </>
      )}
    </div>
  )
}
