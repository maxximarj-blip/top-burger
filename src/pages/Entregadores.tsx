import { useCallback, useEffect, useState } from 'react'
import { Periodo, type Intervalo } from '../components/Periodo'
import { Alerta, Botao, Cabecalho, Cartao, Carregando, Vazio } from '../components/ui'
import { baixarCsv, brl, dataBR, hoje, num, somarDias } from '../lib/format'
import { mensagemErro, supabase } from '../lib/supabase'
import type { LinhaEntregador, TipoMovimento } from '../lib/types'
import { NovoMovimento } from './Fechamento'

export function Entregadores() {
  const [periodo, setPeriodo] = useState<Intervalo>({ inicio: somarDias(hoje(), -6), fim: hoje() })
  const [linhas, setLinhas] = useState<LinhaEntregador[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [pagar, setPagar] = useState<{ tipo: TipoMovimento; entregador_id: number; valor: number; descricao: string } | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.rpc('relatorio_entregadores', { p_inicio: periodo.inicio, p_fim: periodo.fim })
    if (error) setErro(mensagemErro(error))
    else {
      setErro(null)
      setLinhas((data as LinhaEntregador[]) ?? [])
    }
    setCarregando(false)
  }, [periodo])

  useEffect(() => {
    carregar()
  }, [carregar])

  const total = (k: keyof LinhaEntregador) => linhas.reduce((s, l) => s + Number(l[k]), 0)

  return (
    <div className="pagina">
      <Cabecalho
        titulo="Acerto de entregadores"
        subtitulo={`${dataBR(periodo.inicio)} a ${dataBR(periodo.fim)} · soma das taxas de entrega do delivery próprio`}
        acoes={<Periodo valor={periodo} aoMudar={setPeriodo} />}
      />
      {erro && <Alerta tom="erro">{erro}</Alerta>}
      <Cartao
        className="sem-padding"
        acoes={
          <Botao disabled={!linhas.length} onClick={() => baixarCsv(`entregadores_${periodo.inicio}_${periodo.fim}.csv`, [
            ['Entregador', 'Entregas', 'Taxas de entrega', 'Valor dos pedidos', 'Já pago', 'Saldo a pagar'],
            ...linhas.map((l) => [l.entregador, l.entregas, Number(l.taxas_entrega), Number(l.valor_pedidos), Number(l.ja_pago), Number(l.saldo)]),
          ])}>Exportar CSV</Botao>
        }
        titulo="Resumo por entregador"
      >
        {carregando ? <Carregando /> : linhas.length === 0 ? <Vazio>Nenhuma entrega própria no período.</Vazio> : (
          <div className="rolagem">
            <table className="tabela">
              <thead>
                <tr><th>Entregador</th><th className="n">Entregas</th><th className="n">Taxas de entrega</th><th className="n">Pedidos levados</th><th className="n">Já pago</th><th className="n">Saldo</th><th /></tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.entregador_id}>
                    <td className="forte">{l.entregador}</td>
                    <td className="n">{num(l.entregas)}</td>
                    <td className="n">{brl(l.taxas_entrega)}</td>
                    <td className="n">{brl(l.valor_pedidos)}</td>
                    <td className="n">{brl(l.ja_pago)}</td>
                    <td className={`n forte ${Number(l.saldo) > 0 ? 'neg' : ''}`}>{brl(l.saldo)}</td>
                    <td className="n">
                      {Number(l.saldo) > 0 && (
                        <Botao onClick={() => setPagar({ tipo: 'pagamento_entregador', entregador_id: l.entregador_id, valor: Number(l.saldo), descricao: `Acerto ${dataBR(periodo.inicio, true)}–${dataBR(periodo.fim, true)}` })}>
                          Registrar pagamento
                        </Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Total</td><td className="n">{num(total('entregas'))}</td><td className="n">{brl(total('taxas_entrega'))}</td>
                  <td className="n">{brl(total('valor_pedidos'))}</td><td className="n">{brl(total('ja_pago'))}</td><td className="n">{brl(total('saldo'))}</td><td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Cartao>
      <p className="campo-dica">
        "Já pago" soma os movimentos de caixa do tipo <em>Pagamento de entregador</em> dentro do período. O pagamento sai do caixa do dia escolhido.
      </p>
      <NovoMovimento aberto={!!pagar} aoFechar={() => setPagar(null)} data={hoje()} aoSalvar={carregar} inicial={pagar ?? undefined} />
    </div>
  )
}
