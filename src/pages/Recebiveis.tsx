import { useEffect, useMemo, useState } from 'react'
import { Periodo, type Intervalo } from '../components/Periodo'
import { Alerta, Botao, Cabecalho, Cartao, Carregando, Kpi, Vazio } from '../components/ui'
import { baixarCsv, brl, dataBR, diaSemana, hoje, num, somarDias } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { LinhaRecebivel } from '../lib/types'

export function Recebiveis() {
  const [periodo, setPeriodo] = useState<Intervalo>({ inicio: hoje(), fim: somarDias(hoje(), 14) })
  const [linhas, setLinhas] = useState<LinhaRecebivel[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    setCarregando(true)
    supabase.rpc('relatorio_recebiveis', { p_inicio: periodo.inicio, p_fim: periodo.fim }).then(({ data, error }) => {
      if (error) setErro(mensagemErro(error))
      else {
        setErro(null)
        setLinhas((data as LinhaRecebivel[]) ?? [])
      }
      setCarregando(false)
    })
  }, [periodo])

  const porDia = useMemo(() => {
    const mapa = new Map<string, LinhaRecebivel[]>()
    linhas.forEach((l) => mapa.set(l.data_prevista, [...(mapa.get(l.data_prevista) ?? []), l]))
    return [...mapa.entries()]
  }, [linhas])

  const porMaquina = useMemo(() => {
    const m = new Map<string, { bruto: number; taxa: number; liquido: number }>()
    linhas.forEach((l) => {
      const a = m.get(l.maquina) ?? { bruto: 0, taxa: 0, liquido: 0 }
      m.set(l.maquina, { bruto: a.bruto + Number(l.valor_bruto), taxa: a.taxa + Number(l.valor_taxa), liquido: a.liquido + Number(l.valor_liquido) })
    })
    return [...m.entries()]
  }, [linhas])

  const soma = (k: 'valor_bruto' | 'valor_taxa' | 'valor_liquido') => linhas.reduce((s, l) => s + Number(l[k]), 0)

  return (
    <div className="pagina">
      <Cabecalho
        titulo="Recebíveis das maquininhas"
        subtitulo="Quando cada venda no cartão/Pix da máquina cai na conta (dias úteis, sem feriados)"
        acoes={<Periodo valor={periodo} aoMudar={setPeriodo} />}
      />
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      {carregando ? <Carregando /> : (
        <>
          <div className="kpis">
            <Kpi destaque rotulo="Líquido a receber" valor={brl(soma('valor_liquido'))} detalhe={`${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)}`} />
            <Kpi rotulo="Bruto" valor={brl(soma('valor_bruto'))} />
            <Kpi rotulo="Taxas" valor={brl(soma('valor_taxa'))} />
            {porMaquina.map(([m, v]) => <Kpi key={m} rotulo={m} valor={brl(v.liquido)} detalhe={`bruto ${brl(v.bruto)}`} />)}
          </div>
          <Cartao titulo="Agenda" className="sem-padding" acoes={
            <Botao disabled={!linhas.length} onClick={() => baixarCsv(`recebiveis_${periodo.inicio}_${periodo.fim}.csv`, [
              ['Data prevista', 'Máquina', 'Forma', 'Vendas', 'Bruto', 'Taxa', 'Líquido'],
              ...linhas.map((l) => [dataBR(l.data_prevista), l.maquina, l.forma, l.comandas, Number(l.valor_bruto), Number(l.valor_taxa), Number(l.valor_liquido)]),
            ])}>Exportar CSV</Botao>
          }>
            {linhas.length === 0 ? <Vazio>Nada previsto para esse período.</Vazio> : (
              <div className="rolagem">
                <table className="tabela">
                  <thead><tr><th>Data</th><th>Máquina</th><th>Forma</th><th className="n">Vendas</th><th className="n">Bruto</th><th className="n">Taxa</th><th className="n">Líquido</th></tr></thead>
                  {porDia.map(([d, ls]) => (
                    <tbody key={d} className="grupo">
                      {ls.map((l, i) => (
                        <tr key={l.maquina + l.forma}>
                          <td>{i === 0 && <strong>{diaSemana(d)} {dataBR(d)}</strong>}</td>
                          <td>{l.maquina}</td><td>{l.forma}</td><td className="n">{num(l.comandas)}</td>
                          <td className="n">{brl(l.valor_bruto)}</td><td className="n neg">{brl(l.valor_taxa)}</td><td className="n">{brl(l.valor_liquido)}</td>
                        </tr>
                      ))}
                      <tr className="subtotal">
                        <td colSpan={6}>Total do dia</td>
                        <td className="n">{brl(ls.reduce((s, l) => s + Number(l.valor_liquido), 0))}</td>
                      </tr>
                    </tbody>
                  ))}
                </table>
              </div>
            )}
          </Cartao>
        </>
      )}
    </div>
  )
}
